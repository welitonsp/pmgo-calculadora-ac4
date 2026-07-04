# Calculadora AC4 — 19º CRPM / PMGO

Aplicação web para o policial militar estimar horas e valores de escalas AC4.
Funciona no computador e no celular, pode ser **instalada como aplicativo (PWA)**
e continua funcionando **offline** após o primeiro acesso.

> Base normativa declarada: Portaria SSP nº 621/2026 — vigência a partir de 01/07/2026.
> Os valores da tabela são configuráveis dentro da própria ferramenta.

## Acesso

[Abrir a Calculadora AC4](https://welitonsp.github.io/pmgo-calculadora-ac4/)

No celular, use a opção **"Adicionar à tela inicial"** do navegador para instalar como app.

## Funcionalidades

- **Lançamento de escalas** com início, término, descrição e marcação de feriado
  (feriado aplica tarifa vermelha o dia inteiro).
- **Cálculo minuto a minuto** de horas diurnas e noturnas:
  - noturno: 22h às 5h;
  - tarifa vermelha: sexta, sábado, domingo e feriados;
  - tarifa azul: demais dias.
- **Dashboard reativo** com total de horas, quantidade de escalas e valor estimado.
- **Filtro por mês** quando há escalas em meses diferentes.
- **Edição, duplicação (para o dia seguinte) e exclusão com desfazer**.
- **Importação de agenda (.ics)** com pré-visualização e confirmação evento a evento —
  eventos com palavras-chave (AC4, extra, serviço, plantão, escala) já vêm pré-selecionados.
- **Exportação**: arquivo `.ics` (Google Calendar) e planilha `.csv` (Excel/Sheets).
- **Relatório em PDF** via botão "Salvar PDF" (impressão do navegador), com brasão,
  agrupamento por dia e valor por escala.
- **Tema claro/escuro** com detecção automática da preferência do sistema.
- **Dados salvos no dispositivo** (localStorage) — nada é enviado a servidores.

## Estrutura do projeto

```txt
index.html            página única da aplicação
css/styles.css        design system (temas, componentes, impressão)
js/app.js             lógica: estado, cálculo, ICS, exportações, UI
sw.js                 service worker (funcionamento offline)
manifest.webmanifest  manifesto PWA
assets/               ícones e brasão (assets/brasao-19crpm.png)
docs/                 escopo e checklist do MVP
```

Sem build, sem dependências: basta servir os arquivos estáticos (GitHub Pages).

## Identidade visual

Coloque o brasão do 19º CRPM em `assets/brasao-19crpm.png`. Se o arquivo não
existir, a interface exibe um escudo genérico no lugar.

## Aviso

Esta ferramenta é apenas apoio de cálculo. O pagamento final depende da escala
validada, da tabela oficial vigente e da conferência administrativa da SSP.
