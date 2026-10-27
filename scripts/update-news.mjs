// Robô do Radar: coleta as notícias do tema definido em site/config.json e grava site/news.json.
// Sem chave da Anthropic roda o modo gratuito (filtro por palavras-chave).
// Com ANTHROPIC_API_KEY, o Claude escolhe as mais relevantes e resume em português.
//
// Uso:
//   node scripts/update-news.mjs                       (modo gratuito)
//   ANTHROPIC_API_KEY=... node scripts/update-news.mjs (com IA)
//   node scripts/update-news.mjs --dry-run             (só coleta e lista)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(here, "..", "site", "news.json");
const CONFIG = JSON.parse(fs.readFileSync(path.join(here, "..", "site", "config.json"), "utf8"));
const TOPIC = CONFIG.topic;

// Claude Opus 5.5 é o modelo padrão. Para reduzir o custo, troque por "claude-haiku-5-5".
const MODEL = "claude-opus-5-5";
const MAX_AGE_HOURS = 72;
const MAX_CANDIDATES = 90;
const MAX_ITEMS = 10;

const BR = "BR";
const INT = "INT";

// Fontes do config.json: "url" para feeds RSS, ou "googleNews" para buscar no Google Notícias
// (útil para portais que bloqueiam o RSS direto).
const FEEDS = CONFIG.feeds.map((f) => ({ ...f, url: f.googleNews ? googleNews(f.googleNews) : f.url }));

function googleNews(query) {
  const q = encodeURIComponent(`${query} when:3d`);
  return `https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

// Palavras-chave do config.json viram uma expressão regular; "*" no fim aceita qualquer terminação
function keywordsRegex(words) {
  if (!words || !words.length) return null;
  const parts = words.map((w) => escapeRegExp(w.trim()).replace(/\\\*$/, "[\\p{L}\\d]*"));
  return new RegExp(`(?<![\\p{L}\\d])(${parts.join("|")})(?![\\p{L}\\d])`, "iu");
}

/* ---------------- Coleta ---------------- */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml,application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), feed);
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

function cleanText(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFeed(xml, feed) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    let title = cleanText(tag(b, "title"));
    let source = feed.name;
    let description = cleanText(tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded"));

    // Atom usa <link href="...">; RSS usa <link>...</link>
    const atomLink = b.match(/<link[^>]*href="([^"]+)"/i);
    const url = cleanText(tag(b, "link")) || (atomLink ? atomLink[1] : "");

    // Google Notícias: o veículo vem em <source> e o título termina com " - Veículo"
    const gSource = cleanText(tag(b, "source"));
    if (gSource) {
      source = gSource;
      title = title.replace(new RegExp(`\\s+-\\s+${escapeRegExp(gSource)}$`), "");
      description = ""; // o "resumo" do Google Notícias só repete o título
    }

    const date = new Date(cleanText(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated")));
    return {
      title,
      description: description.slice(0, 600),
      url,
      source,
      region: feed.region,
      publishedAt: isNaN(date) ? null : date.toISOString(),
    };
  });
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(title) {
  return title.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, " ").trim();
}

async function collect() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;
  const seen = new Set();
  const items = [];

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.warn(`! ${FEEDS[i].name}: ${r.reason.message}`);
      return;
    }
    console.log(`  ${FEEDS[i].name}: ${r.value.length} itens`);
    for (const it of r.value) {
      if (!it.title || !it.url || !it.publishedAt) continue;
      if (new Date(it.publishedAt).getTime() < cutoff) continue;
      const key = normalize(it.title);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }
  });

  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return items.slice(0, MAX_CANDIDATES);
}

/* ---------------- Curadoria e resumo com IA ---------------- */

const CATEGORY_IDS = CONFIG.categories.map((c) => c.id);
const DEFAULT_CATEGORY = CATEGORY_IDS[CATEGORY_IDS.length - 1];
const MAX_INTERNATIONAL = TOPIC.maxInternational ?? 3;

const SYSTEM = `Você é o editor de uma tela de notícias exibida numa TV de escritório. Quem lê é ${TOPIC.audience}, passando pela TV, em poucos segundos.

Sua tarefa: a partir da lista de notícias candidatas, escolha até ${MAX_ITEMS} que mais importam para esse público e reescreva cada uma em português do Brasil.

Como escolher:
- Priorize: ${TOPIC.priorities}.
- Notícias internacionais entram apenas se forem relevantes para o público no Brasil. Use no máximo ${MAX_INTERNATIONAL} internacionais.
- Ignore o que não tem relação com o tema ou o que for propaganda de empresa.
- A marcação Brasil/Internacional da candidata indica só a origem do feed: veículos de outros países podem aparecer como "Brasil". Classifique a region pelo lugar onde o fato acontece.
- Se duas candidatas tratam do mesmo fato, escolha só uma.
- Ordene da mais importante para a menos importante.

Categorias possíveis: ${CONFIG.categories.map((c) => `${c.id} (${c.label})`).join(", ")}. Use ${DEFAULT_CATEGORY} quando nenhuma outra servir.

Como escrever:
- title: manchete curta e clara, no máximo 65 caracteres, sem ponto final.
- summary: uma única frase, no máximo 130 caracteres, que complementa o título.
- Use apenas fatos presentes no título e no trecho da candidata. Não invente números, datas, nomes ou conclusões. Se a candidata só tem título, o resumo deve apenas contextualizar o tema, sem acrescentar fatos.
- Tom neutro e jornalístico. Traduza as internacionais.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "número da candidata escolhida" },
          title: { type: "string" },
          summary: { type: "string" },
          category: { type: "string", enum: CATEGORY_IDS },
          region: { type: "string", enum: [BR, INT], description: "BR se o fato acontece no Brasil; INT caso contrário" },
        },
        required: ["id", "title", "summary", "category", "region"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

async function curate(candidates) {
  const list = candidates
    .map((c, i) =>
      [
        `[${i}] (${c.region === BR ? "Brasil" : "Internacional"} · ${c.source} · ${c.publishedAt.slice(0, 10)})`,
        `Título: ${c.title}`,
        c.description ? `Trecho: ${c.description}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: SYSTEM,
    messages: [{ role: "user", content: `Notícias candidatas:\n\n${list}` }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`O modelo recusou a tarefa (${response.stop_details?.category ?? "sem categoria"})`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Resposta cortada por limite de tokens");
  }

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const { items } = JSON.parse(text);
  const u = response.usage;
  console.log(`  IA: ${u.input_tokens} tokens de entrada, ${u.output_tokens} de saída`);

  // Links, fontes e datas vêm da coleta, nunca do modelo
  const used = new Set();
  return items
    .filter((it) => candidates[it.id] && !used.has(it.id) && used.add(it.id))
    .slice(0, MAX_ITEMS)
    .map((it) => {
      const c = candidates[it.id];
      return {
        title: it.title.trim(),
        summary: it.summary.trim(),
        category: it.category,
        region: it.region,
        source: c.source,
        url: c.url,
        publishedAt: c.publishedAt,
      };
    });
}

/* ---------------- Modo gratuito (sem IA) ---------------- */

// Sem tradução, o modo gratuito usa só as fontes em português.
// Uma notícia entra se vier de um portal especializado ou citar uma das palavras-chave.
const KEYWORDS = keywordsRegex(TOPIC.keywords);
const TITLE_KEYWORDS = keywordsRegex(TOPIC.titleKeywords);
const SPECIALISTS = new Set(TOPIC.specialistSources || []);
const CATEGORY_RULES = CONFIG.categories
  .map((c) => [c.id, keywordsRegex(c.keywords)])
  .filter(([, re]) => re);

const FOREIGN = /\b(portugal|portugues\w*|espanha|frança|frances\w*|itália|reino unido|china|chines\w*|eua|estados unidos|europa|europe\w*|índia|alemanha|chile|argentina|vietnã|austrália|paraguai|japão|méxico)\b/i;

function shortSummary(c) {
  let s = c.description.replace(/\s*(The post|O post) .* (appeared first on|apareceu primeiro em) .*$/i, "").trim();
  if (!s || normalize(s).startsWith(normalize(c.title))) return "";
  const first = s.match(/^.{40,}?[.!?](\s|$)/);
  if (first) s = first[0].trim();
  if (s.length > 150) s = s.slice(0, 147).replace(/\s+\S*$/, "") + "…";
  return s;
}

const JUNK = /\b(teste|vaga|coordenador|gerente|analista|manager|edição do dia)\b|^(notícias|tecnologia & inovação)$/i;

function pickFree(candidates) {
  const perSource = {};
  return candidates
    .filter((c) => c.region === BR && c.title.length >= 35 && !JUNK.test(c.title))
    .filter((c) => SPECIALISTS.has(c.source) || (KEYWORDS && KEYWORDS.test(`${c.title} ${c.description}`)))
    .map((c) => ({ c, score: (TITLE_KEYWORDS && TITLE_KEYWORDS.test(c.title) ? 2 : 0) + (SPECIALISTS.has(c.source) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || b.c.publishedAt.localeCompare(a.c.publishedAt))
    .filter(({ c }) => (perSource[c.source] = (perSource[c.source] || 0) + 1) <= 3)
    .slice(0, MAX_ITEMS)
    .map(({ c }) => {
      // A categoria vem do título; o trecho só desempata quando o título não diz nada
      const rule =
        CATEGORY_RULES.find(([, re]) => re.test(c.title)) ||
        CATEGORY_RULES.find(([, re]) => re.test(c.description));
      return {
        title: c.title,
        summary: shortSummary(c),
        category: rule ? rule[0] : DEFAULT_CATEGORY,
        region: FOREIGN.test(c.title) ? INT : BR,
        source: c.source,
        url: c.url,
        publishedAt: c.publishedAt,
      };
    });
}

/* ---------------- Execução ---------------- */

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Coletando notícias…");
  const candidates = await collect();
  console.log(`${candidates.length} candidatas das últimas ${MAX_AGE_HOURS} h`);

  if (dryRun) {
    for (const c of candidates) console.log(`- [${c.region}] ${c.source}: ${c.title}`);
    return;
  }

  if (candidates.length === 0) {
    console.warn("Nenhuma notícia coletada; mantendo o arquivo anterior.");
    return;
  }

  // Com chave da Anthropic, o Claude escolhe e resume; sem chave, o modo gratuito filtra por palavras-chave
  const useAI = Boolean(process.env.ANTHROPIC_API_KEY);
  console.log(useAI ? "Selecionando e resumindo com IA…" : "Selecionando por palavras-chave (modo gratuito)…");
  const items = useAI ? await curate(candidates) : pickFree(candidates);
  if (items.length < 3) {
    console.warn(`Só ${items.length} notícias selecionadas; mantendo o arquivo anterior.`);
    return;
  }

  const data = { updatedAt: new Date().toISOString(), ai: useAI, items };
  const tmp = OUTPUT + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, OUTPUT);
  console.log(`${items.length} notícias gravadas em site/news.json`);
}

main().catch((err) => {
  console.error("Falha ao atualizar as notícias:", err.message);
  process.exit(1);
});
