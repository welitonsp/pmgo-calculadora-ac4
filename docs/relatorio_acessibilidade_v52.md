# Relatório de Acessibilidade — Calculadora AC4 (v52)

> Auditoria de contraste (WCAG 2.1 AA) e de acessibilidade do DOM, executada em
> 08/07/2026. Substitui a pendência P3 "Lighthouse a11y documentado" do diário
> de bordo. Método: cálculo de razão de contraste em Node (fórmula WCAG) para os
> pares de cor da paleta + inspeção do DOM renderizado via Chrome headless
> (`lang`, headings, `alt`, nomes acessíveis de botões, rótulos de formulário,
> `dialog`, skip-link, live regions).

## Resumo

- **Estrutura/semântica do DOM: aprovada.** `lang="pt-BR"`, viewport presente,
  0 imagens sem `alt`, 0 botões sem nome acessível, 0 campos de formulário sem
  rótulo, skip-link presente, 4 live regions (`aria-live`/`role=status`), todos
  os `dialog` com `aria-modal` e nome acessível.
- **Contraste: 12 de 15 pares passavam; os 2 mais críticos foram corrigidos
  nesta versão** (ver tabela). Restam 2 itens menores documentados abaixo.

## Contraste WCAG 2.1 AA (alvo 4.5:1 para texto normal, 3:1 para UI)

| Par de cores | Antes | Depois (v52) | Status |
| --- | --- | --- | --- |
| Texto normal `#122033` sobre `--bg` (claro) | 15,13:1 | — | ✅ |
| Texto normal sobre `--surface` (claro) | 16,40:1 | — | ✅ |
| **Texto muted sobre `--bg` (claro)** | 4,23:1 ❌ | **4,54:1** (`#66778c`→`#627286`) | ✅ corrigido |
| Texto muted sobre `--surface` (claro) | 4,58:1 | 4,92:1 | ✅ |
| Valor verde `green-700` sobre surface | 5,48:1 | — | ✅ |
| Perigo `red-600` sobre surface | 4,83:1 | — | ✅ |
| Texto branco sobre `primary` (botão) | 16,52:1 | — | ✅ |
| `primary-text` sobre `primary-soft` (chip) | 10,86:1 | — | ✅ |
| Texto normal sobre `--bg`/`--surface` (escuro) | 16,23 / 14,84:1 | — | ✅ |
| Texto muted sobre surface (escuro) | 8,20:1 | — | ✅ |
| Ouro `primary` sobre `--bg` (escuro) | 8,99:1 | — | ✅ |
| **Texto faint sobre surface (escuro)** | 4,42:1 ❌ | **4,59:1** (`#71829a`→`#73859d`) | ✅ corrigido |
| Borda ouro sobre navy (decorativa, alvo 3:1) | 12,26:1 | — | ✅ |

## Itens residuais (menores) — recomendação, sem correção automática nesta versão

1. **`--text-faint` no tema claro (`#93a4b7`) — 2,55:1 sobre `--surface`.**
   Falha o AA para texto. É usado apenas em textos **suplementares e pequenos**
   (rótulo "(opcional)", `.table-note`, `.fim-hint`, dicas). Corrigir para o AA
   pleno exige escurecer para ~`#6b7886` (4,5:1 sobre `#fff`), o que é uma
   **mudança visível** em todas essas dicas e reduz a hierarquia entre "muted" e
   "faint". Recomendação: aprovar com o gestor antes de aplicar, pois altera a
   aparência das dicas em todo o app. *(Mudança de layout/estética depende de
   pedido — regra do projeto.)*
2. **Dois `<h1>` no DOM.** O segundo está em `#printReport` (título do relatório
   **de impressão**, `display:none` em tela). É defensável como título do
   documento impresso, mas o Lighthouse conta como heading duplicado.
   Recomendação: se desejar 100% no critério de headings, trocar o `<h1>` do
   relatório de impressão por `<p>` estilizado (sem impacto visual no PDF).

## Correções aplicadas na v52

- `--text-muted` (claro): `#66778c` → `#627286` (ajuste imperceptível, +0,3 no
  contraste; passa em `--bg` e em todas as superfícies).
- `--text-faint` (escuro): `#71829a` → `#73859d` (ajuste imperceptível; passa em
  `--surface` e `--bg` escuros).
- `#dialogConfirm` ganhou `aria-label="Confirmação"` (antes não tinha nome
  acessível).

## Como reproduzir a auditoria

O cálculo de contraste usa a fórmula oficial WCAG (luminância relativa) e a
checagem de DOM roda no Chrome headless via CDP — mesmo padrão dos testes do
projeto (`tests/smoke.mjs`). Não requer instalar o Lighthouse nem dependências
npm. Para um número oficial do Lighthouse (score 0–100), rodar
`npx lighthouse <url> --only-categories=accessibility` numa máquina com acesso à
rede — os itens acima são os que ele apontaria.
