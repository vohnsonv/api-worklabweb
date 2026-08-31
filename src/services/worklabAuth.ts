import axios, { AxiosInstance } from 'axios';
import { chromium } from 'playwright';
import { SettingsService } from './settingsService';

export interface AuthSession {
  cookiesStr: string;
  jwtToken: string;
}

// Autentica no WorkLab via Chromium headless e mantem a sessao em cache por 30 minutos.
export class WorklabAuth {
  private static session: AuthSession | null = null;
  private static lastLoginTime = 0;

  static async authenticate(): Promise<AuthSession> {
    const now = Date.now();
    if (this.session && now - this.lastLoginTime < 30 * 60 * 1000) {
      return this.session;
    }

    const url = SettingsService.get('worklab_url');
    const username = SettingsService.getWorklabUsername();
    const password = SettingsService.get('worklab_password');

    console.log('[auth] Realizando login no WorkLab...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      let navigated = false;
      for (let attempt = 1; attempt <= 3 && !navigated; attempt++) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          navigated = true;
        } catch {
          if (attempt === 3) throw new Error('Nao foi possivel acessar a pagina de login');
          await new Promise((res) => setTimeout(res, 2000));
        }
      }

      await page.fill('input[name="username"]', username);
      await page.fill('input[name="password"]', password);
      await page.click('button#logar');

      await page.waitForURL(
        (u) => u.toString().includes('welcome.php') || u.toString().includes('index.php'),
        { timeout: 15000 }
      );

      const cookies = await context.cookies();
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const tokenCookie = cookies.find((c) => c.name === 'worklab-api-token');
      const jwtToken = tokenCookie ? tokenCookie.value : '';

      if (!cookieStr.includes('PHPSESSID') || !jwtToken) {
        throw new Error('Falha ao obter cookies e token JWT do WorkLab');
      }

      this.session = { cookiesStr: cookieStr, jwtToken };
      this.lastLoginTime = Date.now();
      console.log('[auth] Sessao estabelecida.');
      return this.session;
    } finally {
      await browser.close();
    }
  }

  // Cliente para a API JSON nativa do WorkLab.
  static async getApiClient(): Promise<AxiosInstance> {
    const session = await this.authenticate();
    return axios.create({
      baseURL: 'https://api.worklabweb.com.br',
      headers: {
        Authorization: `Bearer ${session.jwtToken}`,
        Cookie: session.cookiesStr,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000
    });
  }

  // Cliente para as paginas web legadas (jqGrid / DataTables).
  static async getWebClient(): Promise<AxiosInstance> {
    const session = await this.authenticate();
    return axios.create({
      baseURL: 'https://www.worklabweb.com.br',
      headers: {
        Cookie: session.cookiesStr,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 30000
    });
  }
}
