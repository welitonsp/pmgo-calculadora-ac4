# Calculadora AC4

## Descrição

A Calculadora AC4 é uma aplicação web estática, instalável como PWA, voltada ao apoio no cálculo de escalas AC4.

A ferramenta permite a simulação e a conferência administrativa preliminar de horas e valores a partir dos horários informados pelo usuário. O resultado apresentado é estimativo, não possui efeito financeiro oficial e não substitui conferência administrativa, folha oficial, ordem de serviço, ato administrativo ou validação pela seção competente.

A interface utiliza identidade visual neutra e institucional, sem exibição de brasão específico na tela principal ou nos relatórios gerados.

## Acesso

A aplicação está publicada no GitHub Pages da organização:

[https://calculadora-ac4-pmgo.github.io/](https://calculadora-ac4-pmgo.github.io/)

Em dispositivos móveis, é possível usar a opção do navegador para adicionar a aplicação à tela inicial, quando disponível.

## Funcionalidades

- Lançamento de escalas com data e horário de início e término.
- Cálculo de horas diurnas, horas noturnas e valor estimado por escala.
- Consolidação de total de horas, quantidade de escalas e valor estimado.
- Filtro por mês quando houver escalas em períodos diferentes.
- Edição, duplicação e exclusão de escalas lançadas.
- Exportação de agenda em `.ics`, compatível com importação manual em aplicativos de agenda, especialmente Google Agenda.
- Exportação de planilha em `.csv`.
- Geração de relatório em PDF pela função de impressão do navegador.
- Tema claro/escuro com persistência da preferência do usuário.
- Funcionamento como PWA, com suporte offline após o primeiro carregamento em navegadores compatíveis.

## Regras de cálculo

Base normativa informada: Portaria SSP nº 621/2026, com vigência a partir de 01/07/2026.

Valores utilizados pela aplicação:

| Faixa | Valor |
| --- | ---: |
| Azul diurna | R$ 30,00/h |
| Azul noturna | R$ 33,00/h |
| Vermelha diurna | R$ 40,00/h |
| Vermelha noturna | R$ 45,00/h |

O horário noturno é considerado de 22h00 até 04h59. A partir de 05h00, o período volta a ser tratado como diurno.

Na regra atual da aplicação, a tarifa azul ou vermelha é definida pelo dia de início da escala e mantida durante toda a escala. Escalas iniciadas em sexta-feira, sábado ou domingo são tratadas como vermelhas; escalas iniciadas nos demais dias são tratadas como azuis.

Exemplo: uma escala com início na sexta-feira às 18h e término no sábado às 08h é calculada integralmente como vermelha, mesmo atravessando a virada de dia.

## Privacidade e armazenamento

Os dados são armazenados somente no navegador do usuário.

- As escalas lançadas ficam em `sessionStorage`.
- Configurações e preferência de tema ficam em `localStorage`.
- Nenhuma escala, configuração ou informação de uso é enviada para servidor.
- Os dados podem ser perdidos ao fechar a aba, limpar os dados do navegador ou usar modo anônimo/privado.

## Estrutura do projeto

```txt
index.html            página única da aplicação
css/styles.css        estilos, temas, componentes e regras de impressão
js/app.js             lógica de estado, cálculo, interface e exportações
sw.js                 service worker para funcionamento offline
manifest.webmanifest  manifesto PWA
assets/               ícones e imagens da aplicação
docs/                 documentos auxiliares do projeto
```

## Projeto estático

O projeto é composto por arquivos estáticos e não depende de backend, banco de dados, servidor próprio ou autenticação.

A publicação pode ser feita diretamente por um serviço de hospedagem estática, como GitHub Pages. O processamento ocorre no navegador do usuário.

## Como usar

1. Acesse o endereço oficial da aplicação.
2. Informe a data e o horário de início da escala.
3. Informe a data e o horário de término da escala.
4. Confira o detalhamento de horas diurnas, horas noturnas e valor estimado.
5. Use as opções de edição, duplicação, exclusão ou exportação conforme necessário.
6. Em caso de uso administrativo, realize a conferência pelos documentos e fluxos oficiais aplicáveis.

## Exportações

A aplicação oferece recursos de exportação para apoiar conferência e organização individual:

- `.ics`: arquivo de calendário compatível com aplicações como Google Calendar, Outlook e similares.
- `.csv`: planilha simples para abertura em Excel, Google Sheets ou ferramentas equivalentes.
- PDF: relatório gerado pela função de impressão ou salvamento em PDF do navegador, com layout otimizado para A4.

As exportações refletem os dados informados e calculados no navegador, mantendo o caráter de simulação e conferência preliminar.

## Testes de regressão

A aplicação possui uma rotina de testes de regressão disponível no console do navegador pela função:

```js
__ac4Testes()
```

Essa rotina valida cenários de cálculo por categoria de hora e valor total, incluindo casos de escalas azuis, vermelhas, diurnas, noturnas e escalas que atravessam a virada de dia.

A exportação `.ics` também pode ser validada no console pela função:

```js
__ac4ValidarICS()
```

Essa validação confere a estrutura básica iCalendar, campos obrigatórios dos eventos, uso de CRLF, limite de linhas dobradas e ordem entre `DTSTART` e `DTEND`.

## Aviso institucional

Esta ferramenta é um recurso de apoio para simulação e conferência administrativa preliminar. Ela não possui efeito financeiro oficial e não substitui escala validada, folha oficial, ordem de serviço, ato administrativo, conferência administrativa ou validação pela seção competente.

A base normativa e os valores apresentados devem ser conferidos com os atos vigentes e com os procedimentos administrativos aplicáveis antes de qualquer uso formal.

## Status do projeto

Projeto em uso como aplicação web estática/PWA, publicado via GitHub Pages da organização `calculadora-ac4-pmgo`.

Alterações em regras de cálculo, valores, base normativa ou fluxos administrativos devem ser tratadas com revisão específica e conferência de regressão.

## Licença e uso

Este repositório não declara, neste momento, uma licença formal em arquivo próprio.

O uso, redistribuição ou adaptação do conteúdo deve observar a autorização do responsável pelo repositório e as normas administrativas aplicáveis. A aplicação deve ser utilizada apenas como apoio de simulação e conferência preliminar.
