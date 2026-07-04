# Calculadora AC4 — 19º CRPM / PMGO

Aplicação web para o policial militar estimar horas e valores de escalas AC4.
Funciona no computador e no celular, pode ser **instalada como aplicativo (PWA)**
e continua funcionando **offline** após o primeiro acesso.

> Base normativa declarada: Portaria SSP nº 621/2026 — vigência a partir de 01/07/2026.
> Valores aplicados: azul diurno R$ 30,00/h, azul noturno R$ 33,00/h,
> vermelha diurna R$ 40,00/h e vermelha noturna R$ 45,00/h.

## Acesso

[Abrir a Calculadora AC4](https://welitonsp.github.io/pmgo-calculadora-ac4/)

No celular, use a opção **"Adicionar à tela inicial"** do navegador para instalar como app.

## Funcionalidades

- **Lançamento de escalas** com início, término e descrição.
- **Cálculo minuto a minuto** de horas diurnas e noturnas:
  - noturno: 22h às 5h;
  - tarifa vermelha: sexta, sábado e domingo;
  - tarifa azul: demais dias.
- **Tabela oficial da Portaria SSP nº 621/2026** exibida na interface e usada no cálculo.
- **Dashboard reativo** com total de horas, quantidade de escalas e valor estimado.
- **Filtro por mês** quando há escalas em meses diferentes.
- **Edição, duplicação (para o dia seguinte) e exclusão com desfazer**.
- **Importação de agenda (.ics)** com pré-visualização e confirmação evento a evento —
  eventos com palavras-chave (AC4, extra, serviço, plantão, escala) já vêm pré-selecionados.
- **Exportação**: arquivo `.ics` (Google Calendar) e planilha `.csv` (Excel/Sheets).
- **Relatório em PDF** via botão "Salvar PDF" (impressão do navegador), com brasão,
  tabela de escalas e valor por escala.
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
