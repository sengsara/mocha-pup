#!/usr/bin/env node

import path from 'path';
import program from 'commander';
import glob from 'glob';
import webpack from 'webpack';
import puppeteer from 'puppeteer';
import chalk from 'chalk';
import findUp from 'find-up';
import { buildAndServe } from './build-and-serve';
import { launchPage, listenToTests, IMochaStatus } from './launch-page';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version, description } = require('../package.json');

process.on('unhandledRejection', printErrorAndExit);

program
    .version(version, '-v, --version')
    .description(description)
    .usage('[options] <glob ...>')
    .option('-c, --webpack-config <config file>', 'webpack configuration file to bundle with')
    .option('-d, --dev', 'avoids single run, and sets mocha to html reporter')
    .option('-b, --browser', 'launches browser (false by default with --dev)')
    .option('-l, --list-files', 'list found test files')
    .option('-t, --timeout <ms>', 'mocha timeout in ms', 2000)
    .option('-p, --port <number>', 'port to start the http server with', 3000)
    .option('--reporter <spec/html/dot/...>', 'mocha reporter to use (default: "spec")')
    .option('--ui <bdd|tdd|qunit|exports>', 'mocha user interface', 'bdd')
    .option('--no-colors', 'turn off colors (default: env detected)')
    .parse(process.argv);

const {
    args,
    webpackConfig: webpackConfigPath = findUp.sync('webpack.config.js'),
    dev,
    listFiles,
    colors,
    reporter,
    timeout,
    ui,
    port: preferredPort
} = program;

const testFiles: string[] = [];
for (const arg of args) {
    for (const foundFile of glob.sync(arg, { absolute: true }).map(path.normalize)) {
        testFiles.push(foundFile);
    }
}

const { length: numFound } = testFiles;
if (numFound === 0) {
    printErrorAndExit(chalk.red(`Cannot find any test files`));
}

console.log(`Found ${numFound} test files in ${process.cwd()}`);
if (listFiles) {
    for (const foundFile of testFiles) {
        console.log(`- ${foundFile}`);
    }
}

const launchOptions: puppeteer.LaunchOptions = dev
    ? { defaultViewport: null, devtools: true }
    : { defaultViewport: { width: 1024, height: 768 } };

// load user's webpack configuration
const webpackConfig: webpack.Configuration = webpackConfigPath ? require(path.resolve(webpackConfigPath)) : {};
if (typeof webpackConfig === 'function') {
    printErrorAndExit(chalk.red('Webpack configuration file exports a function, which is not yet supported.'));
}

const defaultReporter = dev ? 'html' : 'spec';

async function main() {
    const closables: Array<() => Promise<unknown>> = [];
    try {
        const { close: closeServer, compiler, port } = await buildAndServe({
            preferredPort,
            webpackConfig,
            colors: colors === undefined ? !!chalk.supportsColor : colors,
            reporter: reporter || defaultReporter,
            timeout,
            ui,
            testFiles
        });
        closables.push(closeServer);

        compiler.hooks.watchRun.tap('mocha-pup', () => console.log('Bundling using webpack...'));
        compiler.hooks.done.tap('mocha-pup', stats => {
            if (stats.hasErrors() || stats.hasWarnings()) {
                console.log(stats.toString());
            }
            console.log('Done bundling.');
        });

        await new Promise((res, rej) => {
            compiler.hooks.done.tap('mocha-pup-first-build', stats => {
                if (stats.hasErrors() && !dev) {
                    rej(stats.toString());
                } else {
                    res();
                }
            });
        });

        const { close: closeClient, page } = await launchPage(launchOptions);
        closables.push(closeClient);
        const onPageCrash = new Promise<IMochaStatus>((_res, rej) => page.once('error', rej));
        const onUncaughtPageException = new Promise<IMochaStatus>((_res, rej) => page.once('pageerror', rej));

        await page.goto(`http://localhost:${port}/mocha.html`);
        const { failed } = await Promise.race([listenToTests(page), onPageCrash, onUncaughtPageException]);
        if (!dev && failed) {
            // tslint:disable-next-line: no-string-throw
            throw `${failed} tests failed!`;
        }
    } catch (e) {
        printErrorAndExit(e);
    } finally {
        if (!dev) {
            for (const close of closables) {
                await close();
            }
            closables.length = 0;
        }
    }
}
main();

function printErrorAndExit(message: unknown) {
    console.error(message);
    if (!dev) {
        // keep process open in dev mode
        process.exit(1);
    }
}
