import express from 'express';
import webpack from 'webpack';
import webpackDevMiddleware from 'webpack-dev-middleware';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import { safeListeningHttpServer } from 'create-listening-server';

const mochaSetupPath = require.resolve('../static/mocha-setup.js');

export interface IListeningServer {
    compiler: webpack.Compiler;
    port: number;
    close(): Promise<void>;
}

export interface IBuildAndServeOptions {
    testFiles: string[];
    colors?: boolean;
    reporter?: string;
    ui?: string;
    timeout?: number;
    preferredPort?: number;
    webpackConfig?: webpack.Configuration;
}

export async function buildAndServe(options: IBuildAndServeOptions): Promise<IListeningServer> {
    const { testFiles, webpackConfig = {}, preferredPort = 3000 } = options;
    const compiler = webpack({
        mode: 'development',
        ...webpackConfig,
        entry: {
            ...getEntryObject(webpackConfig.entry),
            mocha: mochaSetupPath,
            units: testFiles
        },
        plugins: createPluginsConfig(webpackConfig.plugins, options)
    });

    const devMiddleware = webpackDevMiddleware(compiler, { logLevel: 'warn', publicPath: '/' });

    const app = express();
    app.use(devMiddleware);

    const { httpServer, port } = await safeListeningHttpServer(preferredPort, app);

    return {
        compiler,
        port,
        async close() {
            await new Promise((res, rej) => httpServer.close(err => (err ? rej(err) : res())));
            await new Promise(res => devMiddleware.close(res));
        }
    };
}

function createPluginsConfig(existingPlugins: webpack.Plugin[] = [], options: IBuildAndServeOptions): webpack.Plugin[] {
    return [
        ...existingPlugins,

        // insert html webpack plugin that targets our own chunks
        new HtmlWebpackPlugin({ filename: 'mocha.html', title: 'mocha tests', chunks: ['mocha', 'units'] }),

        // inject options to mocha-setup.js (in "static" folder)
        new webpack.DefinePlugin({
            'process.env': {
                MOCHA_UI: JSON.stringify(options.ui),
                MOCHA_COLORS: options.colors,
                MOCHA_REPORTER: JSON.stringify(options.reporter),
                MOCHA_TIMEOUT: options.timeout
            }
        })
    ];
}

/**
 * Helper around handling the multi-type entry field of user webpack config.
 * Converts it to object style, to allow adding additional chunks.
 */
function getEntryObject(entry: string | string[] | webpack.Entry | webpack.EntryFunc = {}): webpack.Entry {
    const entryType = typeof entry;

    if (entryType === 'string' || Array.isArray(entry)) {
        return { main: entry as string | string[] };
    } else if (entryType === 'object') {
        return entry as webpack.Entry;
    }
    throw new Error(`Unsupported "entry" field type (${entryType}) in webpack configuration.`);
}
