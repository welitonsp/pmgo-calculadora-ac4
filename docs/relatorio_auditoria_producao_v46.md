# Auditoria Completa de Produção — Calculadora AC4 (PMGO)

- **Data:** 07/07/2026
- **Escopo:** repositório `calculadora-ac4-pmgo.github.io` @ `main` (v46, commit `366ee5a`), 28 arquivos rastreados; produção verificada em `https://calculadora-ac4-pmgo.github.io/`.
- **Modo:** somente leitura — nenhum arquivo de aplicação alterado, nenhum deploy.
- **Auditor:** revisão assistida (Claude Code), padrão Big Tech: engenharia, segurança, arquitetura, SRE, produto, UX, LGPD e qualidade.
- **Nota de maturidade:** **8,0/10** — apto a permanecer em produção; dois P1 de correção rápida; nenhum P0.

---

## 1. Resumo executivo

**Estado geral:** sistema maduro para o porte — SPA estática vanilla (zero dependências npm de runtime), regras de negócio isoladas em módulos puros (`js/modules/calculo.mjs`, `formato.mjs`, `agenda.mjs`), CI com 3 camadas de teste bloqueando deploy, CSP ativa, analytics sem cookies, dados 100% locais no navegador. Privacidade por design real, não apenas declarada.

**Principais riscos encontrados:**

1. **P1 — Divergência entre a regra documentada no README e a regra implementada no código** (dia de início × classificação minuto a minuto). Um dos dois está errado perante a Portaria — e é um documento público institucional.
2. **P1 — Duração de escala sem teto rígido + cálculo O(minutos)**: um erro de digitação no ano (ex.: 2036 em vez de 2026) cria uma escala de ~5 milhões de minutos que trava o navegador em **todo** carregamento (a escala fica salva no `localStorage`), inutilizando o app para aquele usuário.
3. P2 — CSV exportado sem neutralização de fórmulas (CSV injection ao abrir no Excel).
4. P2 — CI não roda em pull requests (só em push na `main`).

**Principais fortalezas:** separação regra/UI exemplar; tabela de tarifas **congelada por lançamento** (histórico sobrevive a mudança de Portaria); `escapeHTML` aplicado consistentemente em todos os pontos de interpolação de entrada do usuário; testes de cálculo + smoke + mobile no CI; LGPD por minimização genuína.

**Nível de confiança da auditoria:** alto para código, testes, segurança frontend e LGPD (evidência direta); **médio para conformidade normativa do cálculo** — o texto da Portaria SSP nº 621/2026 não está no repositório, então a regra "correta" oficial é *Não comprovado — necessita validação manual*.

## 2. Veredito sobre produção

- **Pode permanecer em produção? Sim.** Nenhum achado exige retirada do ar.
- **Existe P0? Não.** Sem segredo exposto, sem vazamento de dados, sem quebra total, sem evidência de cálculo errado perante a regra que os próprios testes consagram.
- **Existe P1 urgente? Sim, dois:** (a) alinhar README × código na regra Azul/Vermelha e validar contra a Portaria; (b) impor teto de duração no formulário para eliminar o travamento por typo de ano.
- **Ordem de correção:** P1-A (documental/normativo) e P1-B (teto de duração) primeiro; depois CSV injection e CI em PR.
- **Ausência de login é adequada? Sim, e é o desenho correto.** Simulador de consulta sem efeito financeiro oficial, dados exclusivamente locais — exigir identificação criaria risco LGPD onde hoje não existe nenhum.

## 3. Matriz de riscos

| Prioridade | Área | Problema | Evidência | Impacto | Correção recomendada | Critério de aceite |
|---|---|---|---|---|---|---|
| **P1** | Regra de negócio / Docs | README documenta "tarifa definida pelo dia de **início** e mantida durante toda a escala"; o código classifica **minuto a minuto** com dia operacional (madrugada ≤04:59 pertence ao dia anterior) | `README.md:48-50` vs `calculo.mjs:43-49`; o teste oficial `'Início qui, vira sex 02/07 20h→sex 6h' = R$ 331,00` comprova mistura Azul+Vermelha numa mesma escala (2h AD + 7h AN + 1h **VD**); UI exibe chips "Vermelha" e "Azul" simultâneos (`app.js:894-895`) | Documento público ensina regra diferente da aplicada → contestação administrativa, perda de confiança; se a Portaria disser "dia de início", o cálculo está errado | Validar o texto da Portaria; corrigir README **ou** o cálculo (com aprovação formal). Qual regra é a normativa: *Não comprovado — necessita validação manual* | README, tela e testes descrevem exatamente a mesma regra, com referência ao artigo da Portaria |
| **P1** | Disponibilidade / Validação | Sem teto de duração: `validarIntervaloEscala` só exige `fim > inicio` (`formato.mjs:78-85`); >24h pede apenas confirmação (`app.js:360-366`); `calcularEscala` itera minuto a minuto (`calculo.mjs:43`) | Escala com fim em 2036 ≈ 5,2M iterações × recalculada em **cada** `render()` e em cada load (escala persiste no `localStorage`) | Typo de ano → app congela permanentemente para o usuário até limpar dados do navegador; perda de todas as escalas lançadas | Teto rígido no `validarFormulario` (ex.: rejeitar >48h ou >7 dias com mensagem clara) — mudança só em validação de UI, sem tocar `calculo.mjs` | Inserir fim com ano errado exibe erro e não salva; teste automatizado cobrindo o caso |
| **P2** | Segurança / Exportação | CSV injection: campo Unidade iniciado com `=`, `+`, `-`, `@` vira fórmula ao abrir no Excel | `exportarCSV` (`app.js:~1134`) só escapa aspas, não neutraliza prefixo de fórmula | Planilha aberta em máquina institucional pode executar fórmula maliciosa (ex.: `=HYPERLINK`) | Prefixar `'` quando 1º caractere ∈ `=+-@` nos campos texto do CSV | Célula com `=2+2` exportada abre como texto literal no Excel |
| **P2** | CI/CD | Testes não rodam em PR — workflow só dispara em `push: main` | `.github/workflows/deploy.yml:3-6`; PRs #22/#23 quebraram a `main` (runs `failure`) | Regressão só é detectada após merge; deploy fica bloqueado, mas `main` quebra e exige PR corretivo | Adicionar `pull_request:` ao gatilho do job `test` | Checks aparecem no PR antes do merge |
| **P2** | Segurança | CSP com `style-src 'unsafe-inline'`; `frame-ancestors` impossível via meta tag (GitHub Pages não permite headers) | `index.html:9` | Reduz a proteção da CSP contra XSS via estilo; clickjacking teoricamente possível (impacto baixo: app sem sessão/ação sensível) | Manter registrado como limitação da plataforma; avaliar remover estilos inline do JS no longo prazo | Item documentado como risco aceito |
| **P3** | Publicação | `docs/` (relatórios internos), `tests/` e `tools/` publicados no site — artefato Pages = raiz do repo | `deploy.yml:54` (`path: .`) | Exposição de documentos internos (baixa sensibilidade — repo já é público) e peso desnecessário | Publicar subconjunto (excluir docs/tests/tools do artefato) | URL `/docs/...` retorna 404 em produção |
| **P3** | Assets | `assets/brasao-19crpm.png` (18,6 KB) sem nenhuma referência no código; README afirma "sem exibição de brasão" | `git grep brasao` → 0 ocorrências | Asset morto publicado; contradição com identidade neutra | Remover o arquivo | Asset ausente do repo e do site |
| **P3** | Docs | Árvore de estrutura do README omite `js/modules/` e diz que `app.js` contém o cálculo | `README.md:64-77` | Documentação desatualizada confunde manutenção futura | Atualizar a seção | README reflete a árvore real |
| **P3** | UX/Resiliência | Sem `<noscript>` — com JS bloqueado a página fica em branco sem explicação | grep `noscript` → 0 | Usuário em navegador restritivo não entende a falha | Adicionar `<noscript>` com aviso de 1 linha | Mensagem visível com JS desativado |
| **P3** | Validação | `lerQtdPm` sem clamp superior para valor digitado (stepper limita 999, digitação não) | `app.js:318` | Valor absurdo multiplica total (autoinfligido) | Clampar a 999 também na leitura | Digitar 10⁶ resulta em 999 |
| **P3** | UX/Precisão | `fmtHorasCheias` arredonda para hora cheia em chips/WhatsApp/ICS (1h30 noturno exibe "2h") enquanto o valor cobra por minuto | `formato.mjs:15`; uso em `app.js:897, 592` | Leitor pode achar que horas exibidas × tarifa ≠ valor | Exibir `fmtHoras` (com minutos) onde couber, ou nota "≈" | Duração parcial exibida sem ambiguidade |
| **P4** | LGPD/UX | Campo "Unidade" é texto livre — usuário pode digitar dado pessoal por conta própria | `index.html:241` | Baixo — dado fica só no dispositivo | Hint "não insira dados pessoais" | Hint presente |
| **P4** | Observabilidade | Sem monitoramento de erro JS nem uptime externo | Ausência de integração além do CF Analytics | Falha silenciosa só descoberta por relato | Ver §12 | Alerta de indisponibilidade ativo |

## 4. Auditoria LGPD e privacidade

**Veredicto: conforme, com minimização real.**

- **Coleta direta de dados pessoais: inexistente.** Nenhum campo de nome, CPF, RG, matrícula ou contato (identificação pessoal foi removida deliberadamente em fase anterior e não deve retornar).
- **Coleta indireta:** único terceiro é o **Cloudflare Web Analytics** (`index.html:513`) — beacon *cookieless*, sem rastreamento individual, métricas agregadas. O token no HTML é público por design. GitHub Pages registra IPs em logs de infraestrutura próprios (limitação padrão de hospedagem, fora do controle do projeto).
- **`localStorage`:** chaves `pmgoEscalas`, `pmgoConfig`, `pmgoTheme`, `pmgoPwaBanner` — apenas datas, horas, unidade (texto livre), origem e quantidade. Nada sai do dispositivo (não há nenhum `fetch`/envio de dados de escala).
- **Relatórios/PDF/CSV/ICS:** expõem apenas o que o usuário digitou; exportação é ato do próprio titular.
- **URLs:** links de agenda (Google/Outlook) carregam dados da escala na URL — inevitável no formato "add event" e disparado só por ação explícita do usuário.
- **Aviso de privacidade:** existe no README, mas **não há link na interface** (recomendação P3: link "Privacidade" no rodapé).
- **Ausência de identificação é tecnicamente coerente:** nenhuma função no código depende de identidade.

## 5. Auditoria dos cálculos

**Regra implementada** (`calculo.mjs`): classificação **minuto a minuto**; noturno = [22:00, 05:00); minuto entre 00:00–04:59 herda o **dia operacional anterior**; Vermelha = dia operacional ∈ {sex, sáb, dom}; tarifas em **centavos/hora inteiros** (AD 3000, AN 3300, VD 4000, VN 4500); valor = `round(Σ(minutos×tarifa)/60)` — um único arredondamento por escala, em centavos. Multiplicação por Qtd. PM após o arredondamento por PM (consistente em tela, WhatsApp, CSV e PDF).

**Pontos fortes verificados:**

- **Sem risco de float em dinheiro:** tudo em centavos inteiros; `fmtMoeda` só divide por 100 na exibição.
- **Datas sempre no fuso local** (`formato.mjs` evita `toISOString` para parsing); datas impossíveis rejeitadas por round-trip (`combinarDataHoraLocal`). Goiás sem horário de verão — premissa documentada no código.
- **Tabela congelada por lançamento** (`e.tabela`): histórico não muda se a Portaria mudar. Excelente para auditabilidade.
- **Consistência tela × PDF × CSV × ICS:** todos derivam do mesmo `calcularEscala` por escala e somam os mesmos valores arredondados — sem caminho de cálculo paralelo.
- **Reentrância protegida** (`submetendo` + disable no `try/finally`).

**Riscos/erros encontrados:**

1. **Divergência documental (P1)** — o caso de teste `qui 20h → sex 06h = R$ 331` prova que a hora 05h–06h da sexta é cobrada como **Vermelha diurna** (R$ 40), contradizendo o README ("tarifa do dia de início mantida durante toda a escala"). Se a intenção normativa é a do README, há cálculo divergente em produção; se é a do código, há documento público errado. Decisão do gestor com a Portaria em mãos.
2. **Duração sem teto (P1)** — ver matriz.
3. **Arredondamento de exibição (P3)** — `fmtHorasCheias` arredonda 90min→"2h" em chips/resumo; valor cobrado permanece exato por minuto.
4. Edição de escala mantém a tabela congelada original (`app.js:375`) — defensável, mas se o usuário editar escala antiga para datas novas, continua com a tarifa da época do lançamento. Documentar (P3).

**Cenários de teste obrigatórios ausentes:** dom→seg cruzando 05:00 (fronteira Vermelha→Azul); exatamente 22:00→05:00; escala de 1 minuto; término 00:00; >24h confirmada; 29/02 (bissexto).

## 6. Auditoria de segurança

- **Segredos: nenhum.** Só o token público do CF Analytics (por design).
- **Dependências: zero runtime, zero npm.** Superfície de supply chain = 1 script externo (beacon Cloudflare, permitido pela CSP; sem SRI porque o beacon é atualizado dinamicamente — risco aceito).
- **XSS:** os 9 usos de `innerHTML` foram inspecionados individualmente; **toda interpolação de entrada do usuário passa por `escapeHTML`** (toast:176, import:685, cards:818/822, empty:876, chips:901, nota de unidade:905, PDF:972-973, links de agenda:1105-1106). Dialogs usam `textContent`. CSV escapa aspas. Sem vetor de XSS encontrado.
- **CSP** (`index.html:9`): `default-src 'self'`, `object-src 'none'`, `base-uri 'self'` — boa para meta tag (GitHub Pages não permite headers). Fraquezas: `style-src 'unsafe-inline'` e `frame-ancestors` impossível via meta — riscos baixos, registrados.
- **Service Worker:** network-first com fallback, só GET, só same-origin, `updateViaCache: 'none'`, limpeza de caches antigos — evita a classe de bug "app preso em versão velha".
- **Arquivos publicados:** `docs/`, `tests/`, `tools/` vão ao ar (P3); nada sensível.
- **Validação de entrada:** datas estritas; qtd com clamp inferior; duração sem teto (P1).

## 7. Auditoria de UX e layout institucional

- **Tela principal:** hierarquia clara (métricas → lançamento → lista), linguagem institucional correta ("Valor simulado, sujeito à conferência administrativa" em todos os artefatos), identidade sóbria, tema claro/escuro.
- **Formulário:** término automático por duração (com espelho textual `#fimResumo` que contorna bug real de repaint do `datetime-local` em Android), chips 12/14/24h, stepper Qtd. PM, validação com `aria-invalid` + toast.
- **Mobile:** bottom sheet dedicado, cards enxutos, alvos ≥44px, sem overflow — **verificado por teste automatizado** (`mobile-check.mjs`, ~40 checks em 3 viewports + roteiro iOS).
- **Acessibilidade:** skip-link, `aria-label`/`aria-expanded`/`aria-live`, dialogs nativos com Esc, foco devolvido. Falta auditoria de contraste automatizada (P3: Lighthouse a11y).
- **Estados vazios** orientativos; exclusão com `dialogConfirmar` (nunca `confirm()` — quebrava em iOS PWA) e undo.
- **Risco residual de interpretação:** horas arredondadas nos chips (P3).

## 8. Auditoria de PDF e exportações

- **PDF** (`#printReport` + `@media print`): `@page` A4 10mm, cabeçalho com base normativa e data de emissão, resumo geral, tabela 11 colunas em 8pt `table-layout: fixed`, `break-inside: avoid` por linha, rodapé com disclaimer. Padrão suficiente para circulação administrativa. Ressalvas: 11 colunas densas em A4 retrato (P3); sem teste automatizado de print (P3).
- **CSV:** separador `;` (Excel pt-BR), BOM UTF-8, vírgula decimal, linha TOTAL. Falta neutralização de fórmula (P2).
- **ICS:** RFC 5545 com dobra em 75 octetos, CRLF, UIDs estáveis (dedup em reimport), escaping correto, validador próprio + testes no CI — acima do padrão.
- **Exposição de dados pessoais:** nenhuma.
- **Consistência entre formatos:** confirmada (mesma fonte de cálculo).

## 9. Auditoria de código e arquitetura

- **Organização exemplar para vanilla JS:** regras puras em `js/modules/` (sem DOM, testáveis isoladamente), UI/estado em `app.js`, tema em `theme.js`. Pontes explícitas injetam a tabela do DOM nos módulos (`app.js:123-127`).
- **Tamanho:** `app.js` ~1.400 linhas concentra UI, PWA, share, import, print. Aceitável hoje; se crescer, extrair `ui-lista`, `exportacoes`, `pwa` (P4).
- **Duplicação baixa** (helpers `botoesAcaoHTML`, `detalhesEventoAgenda`).
- **Código morto:** `assets/brasao-19crpm.png` (P3).
- **Tipagem:** sem TS/JSDoc-types — aceitável; JSDoc nos módulos puros seria o upgrade barato (P4).
- **Comentários de alta qualidade** — explicam porquês (fuso, CLS, repaint mobile).
- **Versionamento:** cache-busting disciplinado via `tools/bump-version.mjs` (4 pontos sincronizados, v46 coerente).

## 10. Auditoria de testes e CI/CD

**Executado nesta auditoria:** `node tests/run-tests.mjs` → 3 suítes, 17 casos, **todos verdes**; smoke (9 passos) e mobile-check (~40 checks) verdes no CI (run `28911138387` success).

**Cobertura existente:** regras de cálculo (5), geração .ics (7), importação .ics (5), E2E básico, UX mobile.
**Lacunas:** sem lint/typecheck; sem teste de PDF/CSV; casos de fronteira do §5 ausentes; **CI não roda em PR** (P2).

**Matriz mínima obrigatória proposta:**

| # | Cenário | Tipo |
|---|---|---|
| 1 | Fronteiras Azul↔Vermelha: dom 20h→seg 08h; madrugada de dom p/ seg | unitário |
| 2 | Noturno exato 22:00→05:00 (7h AN, 0 diurno) | unitário |
| 3 | Escala de 1 minuto; término 00:00; 29/02/2028 | unitário |
| 4 | Duração acima do teto → rejeição (após correção P1) | unitário + smoke |
| 5 | CSV: campo iniciado com `=` sai neutralizado (após correção P2) | unitário |
| 6 | Total geral = Σ valores por escala (propriedade, 50 escalas aleatórias) | unitário |
| 7 | PDF: `printToPDF` gera ≥1 página e contém o total | smoke |
| 8 | localStorage corrompido → app carrega vazio sem quebrar | smoke |

**CI/CD:** pipeline correto (test → deploy, concurrency, artefato Pages). Recomendações: gatilho `pull_request` no job `test`; artefato parcial (sem docs/tests/tools).

## 11. Auditoria de performance

- **Payload crítico ~180 KB** (HTML 28 + CSS 53 + JS 77 + fonte 48 preload). Sem framework/bundle — excelente para celular simples. Fonte self-hosted com `preload` e `font-display: swap`.
- **`icon-512.png` com 121 KB** — otimizável para ~30-40 KB (P3).
- **Renderização:** `render()` reconstrói tabela+cards a cada mudança — irrelevante no volume real; único gargalo é o P1 de duração extrema.
- **CWV:** INP e CLS medidos (Cloudflare) e corrigidos nas fases 44-45 (backdrop-filter off no mobile, min-height na lista, banner fixed, debounce).
- **Offline/PWA:** shell completo cacheado; repeat-visit praticamente instantâneo.

## 12. Observabilidade compatível com LGPD

**Hoje:** Cloudflare Web Analytics (agregado, cookieless) — adequado. **Não há** monitoramento de erro nem de uptime.

Recomendações (sem identificar usuários):

1. **Uptime externo** (P2 operacional): monitor gratuito pingando a URL pública, alerta por e-mail. Zero impacto LGPD.
2. **Erros JS agregados** (P3): `window.onerror` global com contador anônimo (`{mensagem, arquivo, linha, versao}` — **nunca** conteúdo de campos, nunca IP retido).
3. **Métrica de versão adotada** (P4): campo `versao` detecta usuários presos em cache antigo (dor recorrente do projeto).
4. **Limites explícitos:** nunca coletar valores digitados, unidade, datas de escala, fingerprint, ID de instalação. O dado do PM não sai do aparelho.

## 13. Plano de ação por prioridade

### Fase 1 — Correções urgentes (P1)

1. **Alinhar regra documentada × implementada.** Objetivo: eliminar contradição pública. Arquivos: `README.md` (e, se a Portaria contrariar o código, decisão formal antes de tocar `calculo.mjs`). Risco: contestação administrativa. Esforço: 1h (documental) — ou processo de validação normativa. Aceite: README, UI e testes descrevem a mesma regra citando o dispositivo da Portaria. Testes: fronteiras (§10 itens 1-2).
2. **Teto de duração no formulário.** Objetivo: impossibilitar travamento por typo. Arquivos: `js/app.js` (`validarFormulario`), teste novo. Risco: nenhum (validação de UI; `calculo.mjs` intocado). Esforço: 1-2h. Aceite: duração > limite (sugestão 48h, alinhar com gestor) rejeitada com mensagem clara. Testes: item 4 da matriz.

### Fase 2 — Endurecimento profissional (P2)

3. **Neutralizar CSV injection** (`exportarCSV`): prefixo `'` para `=+-@`. Esforço: 30min. Aceite: item 5 da matriz.
4. **CI em pull request** (`deploy.yml`: gatilho `pull_request` no job test). Esforço: 15min. Aceite: checks visíveis no PR.
5. **Uptime externo com alerta.** Esforço: 30min. Aceite: alerta disparando em teste de indisponibilidade.

### Fase 3 — Refinamento (P3/P4)

6. Remover `brasao-19crpm.png`; excluir docs/tests/tools do artefato Pages; atualizar árvore do README; `<noscript>`; clamp de Qtd. PM digitada; link "Privacidade" no rodapé; otimizar `icon-512.png`; hint "não insira dados pessoais" na Unidade; teste de PDF via `printToPDF`; Lighthouse a11y documentado; JSDoc nos módulos puros. Esforço agregado: ~1 dia.

## 14. Backlog técnico priorizado

| Ordem | Prioridade | Tarefa | Área | Impacto | Esforço | Critério de aceite |
|---|---|---|---|---|---|---|
| 1 | P1 | Validar Portaria e alinhar README × `calculo.mjs` (regra Azul/Vermelha) | Regra/Docs | Alto | 1h + validação | Regra única em código, docs e testes |
| 2 | P1 | Teto de duração no `validarFormulario` | Validação | Alto | 2h | Escala > teto rejeitada; teste verde |
| 3 | P2 | Neutralizar fórmulas no CSV | Segurança | Médio | 30min | `=2+2` exporta como texto |
| 4 | P2 | Gatilho `pull_request` no CI | CI/CD | Médio | 15min | Checks no PR |
| 5 | P2 | Monitor de uptime + alerta | Operação | Médio | 30min | Alerta funcional |
| 6 | P3 | Artefato Pages sem docs/tests/tools + remover brasão | Publicação | Baixo | 1h | `/docs/` → 404; asset removido |
| 7 | P3 | Testes de fronteira do cálculo (§10 itens 1-3, 6) | Testes | Médio | 3h | Suíte ampliada verde no CI |
| 8 | P3 | README (árvore), `<noscript>`, clamp qtd, link privacidade | Docs/UX | Baixo | 2h | Itens verificáveis |
| 9 | P3 | Otimizar `icon-512.png`; teste de PDF | Perf/Testes | Baixo | 2h | Ícone <50KB; printToPDF no smoke |
| 10 | P4 | Erros JS agregados anônimos; JSDoc nos módulos; hint LGPD na Unidade | Observ./Código | Baixo | 4h | Contador de erros sem dado pessoal |

## 15. Conclusão final

- **Confiável?** Sim, com ressalva dos P1: confiabilidade *de execução* alta (cálculo determinístico, testado, em centavos inteiros, consistente entre formatos); confiabilidade *documental* comprometida até resolver a divergência README × código.
- **Cálculo auditável?** Sim — módulo puro de 70 linhas, comentado, tabela congelada por lançamento, testes reproduzíveis (`node tests/run-tests.mjs` e `__ac4Testes()` no console do site).
- **PDF/exportações institucionais?** Sim — PDF A4 com base normativa e disclaimers, CSV Excel pt-BR, ICS RFC 5545 validado por teste. Pendência: CSV injection (P2).
- **Não exigir identificação está correto?** Sim, e deve ser mantido — nenhuma função justifica identificar o PM; a ausência de identificação é a principal garantia LGPD do projeto.
- **Compatível com LGPD?** Sim — minimização real, finalidade clara, dados no dispositivo, analytics agregado sem cookies, sem compartilhamento.
- **Condições mínimas para manter e evoluir:** (1) resolver a divergência normativa antes de divulgação ampliada; (2) implantar o teto de duração; (3) manter a disciplina atual — regra de negócio intocável sem validação formal, testes bloqueando deploy, bump de versão por release; (4) CI em PR e monitor de uptime; (5) nunca introduzir coleta de dados pessoais sem nova análise jurídica.

---

*Pergunta em aberto para o gestor (bloqueia o item 1 do backlog): pela Portaria SSP nº 621/2026, a tarifa Azul/Vermelha é definida pelo dia de início da escala inteira, ou minuto a minuto (como o código faz hoje)?*

---

## Adendo — Resolução da Fase 1 (07/07/2026, mesma data)

O gestor forneceu o texto integral da **Portaria SSP nº 621, de 15/06/2026** (DO/GO nº 24.801, de 17/06/2026), agora transcrito em [`docs/portaria-ssp-621-2026.md`](portaria-ssp-621-2026.md).

**P1-A — RESOLVIDO (código estava correto; README estava errado).** O Anexo I da Portaria define os valores **por dia da semana em que a hora é trabalhada** (colunas Domingo…Sábado), sem qualquer menção a "dia de início da escala". O parágrafo único do Art. 1º define o noturno como "22h de um dia até 5h do dia seguinte", confirmando a regra do dia operacional aplicada em `calculo.mjs` (madrugada pertence ao noturno iniciado no dia anterior). O caso de teste `qui 20h→sex 6h = R$ 331,00` está aderente à norma (2h×30 + 7h×33 + 1h×40). Ação executada: README §Regras de cálculo reescrito para descrever a regra real, com exemplos e link para a transcrição da Portaria. `calculo.mjs` não foi alterado.

**Observação de fronteira registrada:** o texto normativo ("diurno 5h01–21h59", "noturno 22h–5h") deixa o minuto das 5h00 e o intervalo 21h59–22h00 sem enquadramento literal contínuo; a aplicação usa a leitura contínua noturno=[22h00,05h00). Divergência máxima possível: 1 minuto por virada (≤ R$ 0,25/escala). Registrado em `docs/portaria-ssp-621-2026.md` como risco aceito.

**P1-B — RESOLVIDO.** Teto de duração de **192h** (limite de horas que o policial pode fazer, definido pelo gestor) implantado em `validarIntervaloEscala` (`js/modules/formato.mjs`, constante `DURACAO_MAX_HORAS`), valendo para o formulário e para a importação de `.ics` (eventos acima do teto são contados como ignorados). `calculo.mjs` intocado. Testes: 2 casos novos na suíte de lançamento (aceita exatamente 192h; rejeita typo de ano 2036) e a suíte `__ac4TestesLancamento` passou a rodar no smoke test do CI.

Itens P2 seguintes do backlog (CSV injection, CI em PR, uptime) permanecem pendentes — ver §14.
