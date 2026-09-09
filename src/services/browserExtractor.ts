/**
 * Extração assistida: navega na tela real do WorkLab com Playwright
 * (preenche período, clica em Pesquisar, etc.) e devolve o HTML renderizado
 * para parsing. Usado nos módulos cujo conteúdo só aparece após interação.
 */
import { chromium } from 'playwright';
import { WorklabAuth } from './worklabAuth';

export interface FlowStep {
  acao: 'fill' | 'select' | 'click' | 'wait';
  seletor?: string;
  valor?: string;
  texto?: string;
  ms?: number;
}

export interface FlowDef {
  url: string;
  passos: FlowStep[];
}

export async function extrairHtmlPorFluxo(flow: FlowDef): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    // Reaproveita a sessão autenticada do WorklabAuth (login + cookies)
    const sessao = await WorklabAuth.authenticate();
    const context = await browser.newContext();
    const cookies = sessao.cookiesStr
      .split('; ')
      .filter(Boolean)
      .map((par) => {
        const idx = par.indexOf('=');
        return {
          name: idx > 0 ? par.slice(0, idx) : par,
          value: idx > 0 ? par.slice(idx + 1) : '',
          domain: '.worklabweb.com.br',
          path: '/',
        };
      });
    await context.addCookies(cookies);

    const page = await context.newPage();
    await page.goto(flow.url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    for (const passo of flow.passos) {
      if (passo.acao === 'wait') {
        await page.waitForTimeout(passo.ms ?? 3000);
      } else if (passo.acao === 'fill' && passo.seletor && passo.valor !== undefined) {
        const el = await page.$(passo.seletor);
        if (el) {
          await el.fill(passo.valor).catch(() => undefined);
        }
      } else if (passo.acao === 'select' && passo.seletor && (passo.valor || passo.texto)) {
        const el = await page.$(passo.seletor);
        if (el) {
          if (passo.valor) await el.selectOption({ value: passo.valor }).catch(() => undefined);
          else if (passo.texto) await el.selectOption({ label: passo.texto }).catch(() => undefined);
        }
      } else if (passo.acao === 'click' && passo.seletor) {
        const el = await page.$(passo.seletor);
        if (el) {
          await el.click().catch(() => undefined);
        }
      }
    }

    // pequena espera extra para a renderização dos dados
    await page.waitForTimeout(2500);
    const html = await page.content();
    await context.close();
    return html;
  } finally {
    await browser.close();
  }
}

// Converte tabelas-chave/valor (ex.: resumo de caixa) em linhas { rotulo, valor }.
export function tabelasChaveValor(html: string): Record<string, string>[] {
  const linhas: Record<string, string>[] = [];
  for (const t of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
      [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        c[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim(),
      ),
    );
    const comConteudo = rows.filter((r) => r.some((c) => c));
    if (comConteudo.length >= 2 && comConteudo.every((r) => r.length >= 2) && comConteudo[0].length <= 2) {
      for (const r of comConteudo) {
        if (r[0]) linhas.push({ rotulo: r[0], valor: r[1] ?? '' });
      }
    }
  }
  return linhas;
}
