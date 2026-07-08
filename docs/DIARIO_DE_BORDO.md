# Diário de Bordo — Calculadora AC4

> Documento de continuidade do projeto. Registra onde paramos, o que está pendente e como retomar o trabalho **em qualquer estação de trabalho**. Atualizar ao final de cada sessão relevante de desenvolvimento.

---

## Sessão de 07/07/2026 — encerramento

### Estado ao encerrar

| Item | Estado |
| --- | --- |
| Versão em produção | **v49** (cache `ac4-v49`), verificada em https://calculadora-ac4-pmgo.github.io/ |
| Último merge | PR #31 (`b0dd7da` na `main`) |
| CI | Verde — `test` (run-tests + smoke 12 passos + mobile-check) roda em **PRs e na main**; `deploy` só na main |
| Testes locais | Todos verdes na última execução |
| Auditoria de produção | Nota 8,0/10 — **Fases 1, 2 e 3 do plano de ação executadas** |
| Trabalho inacabado | **Nenhum** — não há branch aberto nem mudança pela metade |

### O que foi feito hoje (sequência completa)

1. **PR #27 (v46)** — Agendamento inteligente por plataforma: no celular, "Agenda" abre o app de agenda **padrão do aparelho** (via `.ics`); no desktop, dialog `#dialogAgenda` com Google Agenda / Outlook pessoal / Outlook corporativo (sem gerar arquivo); com N escalas, lista um link por escala. Botão "Adicionar à agenda" removido da topbar.
2. **PR #28** — Auditoria completa de produção documentada em [`relatorio_auditoria_producao_v46.md`](relatorio_auditoria_producao_v46.md) (15 seções, matriz de riscos, backlog de 10 itens).
3. **PR #29 (v47) — Fase 1 da auditoria:**
   - **P1-A resolvido**: o gestor forneceu o PDF da **Portaria SSP nº 621/2026** — o Anexo I confirma que a tarifa é **por dia da semana em que a hora é trabalhada** (minuto a minuto), exatamente como `calculo.mjs` sempre fez. O README estava errado e foi reescrito. Portaria transcrita em [`portaria-ssp-621-2026.md`](portaria-ssp-621-2026.md). **`calculo.mjs` não foi alterado.**
   - **P1-B resolvido**: teto de duração de **192h** (limite de horas que o policial pode fazer — valor definido pelo gestor) em `validarIntervaloEscala` (`formato.mjs`, `DURACAO_MAX_HORAS`). Elimina o travamento por typo de ano.
4. **PR #30 (v48) — Fase 2 + decisão do gestor:**
   - **Importação de `.ics` removida por completo** (decisão: *"não vamos importar nada — o objetivo é fazer cálculo no sistema"*). Saíram: dialog, input de arquivo, `initImportacao` e funções, `parseICS` do `agenda.mjs`, suíte de testes de importação, CSS `.import-*`. −312 linhas. **Exportações preservadas** (agendar/CSV/PDF/compartilhar).
   - CSV injection neutralizado (`csvTextoSeguro` em `formato.mjs` — apóstrofo em células iniciadas por `=` `+` `-` `@`).
   - CI passou a rodar em pull requests (deploy continua só na main).
5. **PR #31 (v49) — Fase 3:**
   - Site público montado em `_site` **sem `docs/`, `tests/` e `tools/`** (relatórios internos fora do ar; seguem no repo). `assets/brasao-19crpm.png` órfão removido.
   - Link **"Privacidade"** no rodapé (dialog com resumo LGPD); hint "não insira dados pessoais" no campo Unidade; `<noscript>`; Qtd. PM digitada clampada a 999.
   - Horas diurnas/noturnas exibidas **com minutos** (`fmtHoras`) em chips/WhatsApp/métricas/PDF/agenda; `fmtHorasCheias` removida.
   - Smoke ganhou 2 passos: relatório de impressão populado + **PDF real** via `Page.printToPDF` (≥10KB).

### Decisões do gestor registradas hoje (não reabrir sem nova decisão)

- **Regra de cálculo**: minuto a minuto por dia da semana, conforme Portaria 621/2026 — validada e correta. Não mexer em `js/modules/calculo.mjs`.
- **Teto de duração**: **192 horas** (limite de horas do policial).
- **Importação**: o sistema **não importa nada** — é ferramenta de cálculo. Não reintroduzir importação de agenda.
- **Sem identificação de usuário** (LGPD por minimização) — não adicionar login/cadastro/dados pessoais.

### Pendências para as próximas sessões

| Prioridade | Item | Observação |
| --- | --- | --- |
| P2 | **Monitor de uptime externo** | Único item que depende do gestor: criar conta gratuita (ex.: UptimeRobot), monitor HTTP para a URL pública, intervalo 5 min, alerta por e-mail. ~3 minutos. |
| P3 | Otimizar `assets/icon-512.png` (~121KB) | Precisa de ferramenta de quantização PNG (pngquant/squoosh) — não disponível na estação anterior. |
| P3 | Testes de fronteira do cálculo | dom→seg cruzando 05h; exatamente 22h→05h; escala de 1 min; término 00:00; 29/02/2028 (ver §10 da auditoria). |
| P3 | Lighthouse a11y documentado | Rodar auditoria de contraste/acessibilidade e registrar resultado. |
| P4 | JSDoc nos módulos puros; erros JS agregados anônimos (`window.onerror` sem dados pessoais) | Evoluções de manutenção/observabilidade. |

### Como retomar em outra estação de trabalho

1. **Pré-requisitos**: Git, Node.js ≥ 22, Google Chrome instalado, GitHub CLI (`gh`).
2. **Clonar e autenticar**:
   ```sh
   git clone https://github.com/calculadora-ac4-pmgo/calculadora-ac4-pmgo.github.io.git
   cd calculadora-ac4-pmgo.github.io
   gh auth login
   ```
3. **Validar o ambiente** (deve ficar tudo verde):
   ```sh
   node tests/run-tests.mjs     # regras de cálculo + geração .ics
   node tests/smoke.mjs         # fluxo E2E em Chrome headless (12 passos, inclui PDF)
   node tests/mobile-check.mjs  # UX mobile (3 viewports + roteiro iOS)
   ```
   (Se o Chrome não for achado automaticamente, defina `CHROME_PATH`.)
4. **Fluxo de trabalho do projeto**:
   - Branch → commit → push → `gh pr create` → **aguardar o check `test` do PR** → `gh pr merge --merge --delete-branch` → CI da main testa de novo e faz o deploy.
   - Qualquer mudança em `index.html`/`css`/`js` exige bump de versão: `node tools/bump-version.mjs <n>` (próxima: **v50**).
   - Smoke pode falhar esporadicamente no runner ("Chrome não expôs o DevTools em 20s") — é flake de infraestrutura; `gh run rerun <id> --failed` resolve. **Exceção**: se o job de *deploy* do Pages falhar, disparar run novo com `gh workflow run deploy.yml` (não usar rerun no deploy).
5. **Ler antes de mexer em regra/valor**: [`portaria-ssp-621-2026.md`](portaria-ssp-621-2026.md) (base normativa) e [`relatorio_auditoria_producao_v46.md`](relatorio_auditoria_producao_v46.md) (riscos e backlog).

### Regras invioláveis do projeto (resumo)

- `js/modules/calculo.mjs` e os valores da Portaria só mudam com **nova norma + decisão formal do gestor**.
- Nunca coletar/armazenar dados pessoais (LGPD) — sem login, sem identificação.
- Ações destrutivas na UI sempre via `dialogConfirmar()` (nunca `confirm()` — quebra em iOS PWA).
- Dados novos no navegador sempre em `localStorage` com prefixo `pmgo*`.
- Mobile-first: regras de layout mobile em `@media (max-width: 760px)`; desktop não muda sem pedido.
- Formulário mobile: campos **empilhados** (rótulo em cima) — nunca rótulo à esquerda com `datetime-local`.
- Nunca confiar no repaint de `input[type=datetime-local]` após set via JS no Android — manter o espelho `#fimResumo`.

---

*Histórico anterior a esta sessão: ver `relatorio_auditoria_producao_v46.md`, `ESCOPO_MVP.md`, `CHECKLIST.md` e o log de PRs (#13–#31) no GitHub.*
