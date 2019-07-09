import puppeteer from 'puppeteer';
import { hookPageConsole } from './hook-page-console';

export async function launchPage(launchOptions: puppeteer.LaunchOptions = {}) {
    const browser = await puppeteer.launch(launchOptions);
    const [page] = await browser.pages();
    hookPageConsole(page);
    return {
        page,
        async close() {
            await browser.close();
        }
    };
}

export interface IMochaStatus {
    completed: number;
    failed: number;
    finished: boolean;
}

export async function listenToTests(page: puppeteer.Page): Promise<IMochaStatus> {
    page.on('dialog', dialog => dialog.dismiss());
    await page.waitForFunction('mochaStatus.finished', { timeout: 0 });
    return page.evaluate('mochaStatus');
}
