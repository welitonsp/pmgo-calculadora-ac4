# Escopo do MVP — Calculadora AC4

## Objetivo

Criar uma ferramenta simples, profissional e segura para facilitar ao policial militar o cálculo de horas e do valor estimado a receber em escalas AC4.

A ferramenta deve permitir que o policial:

- informe seus dados básicos;
- lance escalas manualmente;
- importe eventos da Agenda Google;
- calcule horas diurnas e noturnas;
- estime o valor a receber conforme tabela vigente;
- gere relatório em PDF para salvar, imprimir ou anexar em conferência administrativa.

## Identidade visual

A interface deve utilizar identidade visual neutra e institucional, sem vínculo visual direto a unidade específica.

Requisito de implementação:

- exibir identificação neutra da Calculadora AC4 no cabeçalho;
- não renderizar brasão específico na interface principal;
- não renderizar brasão específico no relatório gerado em PDF;
- manter visual institucional, claro e profissional.

## Módulo 1 — Calculadora manual

Campos mínimos:

- nome do policial;
- posto/graduação;
- unidade;
- mês de referência;
- data e hora de início da escala;
- data e hora de término da escala;
- tipo de escala, quando aplicável;
- descrição da escala.

Cálculos mínimos:

- total de horas;
- horas diurnas;
- horas noturnas;
- valor diurno;
- valor noturno;
- valor total estimado.

## Módulo 2 — Tabela de valores

O sistema deve permitir configurar os valores oficiais vigentes antes do cálculo.

Requisitos:

- cadastrar valores por tipo de escala;
- diferenciar valor diurno e noturno;
- indicar a portaria/tabela utilizada;
- impedir uso profissional quando a tabela estiver vazia ou incompleta;
- preservar possibilidade de atualização futura sem alterar cálculos antigos.

## Módulo 3 — Importação da Agenda Google

### MVP seguro

A primeira versão deve importar a agenda por arquivo `.ics`, exportado pelo próprio policial no Google Agenda.

Parâmetros mínimos:

- arquivo `.ics`;
- data inicial;
- data final;
- palavras-chave para filtrar eventos, como `AC4`, `extra`, `escala` e `serviço extraordinário`;
- pré-visualização dos eventos importados;
- confirmação antes de adicionar os eventos ao cálculo.

### Fase futura — integração direta

A integração direta com Google Agenda por OAuth deve ficar para fase posterior, porque exige:

- credenciais Google Cloud;
- consentimento do usuário;
- política de privacidade;
- tratamento seguro de tokens;
- backend ou fluxo autorizado, sem segredo exposto no frontend público.

## Módulo 4 — Relatório PDF

O sistema deve gerar relatório com:

- título neutro do relatório;
- nome do policial;
- posto/graduação;
- unidade;
- mês de referência;
- lista de escalas;
- horas diurnas;
- horas noturnas;
- valor por escala;
- valor total estimado;
- data/hora de geração;
- aviso de que se trata de simulação sujeita à conferência administrativa.

Na versão inicial, a geração pode ser feita por `window.print()`, permitindo ao policial escolher **Salvar como PDF** no navegador.

## Regras profissionais

- Não fixar valor financeiro sem conferência normativa.
- Não armazenar dados pessoais em banco público sem autenticação.
- Não expor credenciais Google no frontend.
- Não apresentar o cálculo como pagamento oficial sem conferência administrativa.
- Toda evolução institucional deve prever autenticação, permissões e auditoria.

## Critérios de aceite da primeira versão

- O cabeçalho exibe identificação neutra da Calculadora AC4.
- O policial consegue lançar uma escala manual.
- O sistema calcula horas e valor estimado.
- O sistema importa eventos de arquivo `.ics`.
- O sistema filtra eventos por palavras-chave.
- O sistema gera relatório pronto para salvar em PDF.
- O README explica como usar e como ativar o GitHub Pages.
