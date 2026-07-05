# Checklist de Implementação - Calculadora AC4

Com base na auditoria inicial, este é o plano de ação para atingir os requisitos do MVP:

## 1. Reestruturação de Dados e Formulário (Módulo 1)
- [ ] **Campos de Identificação:** Adicionar inputs para `Nome do Policial`, `Posto/Graduação`, `Unidade` e `Mês de Referência` no topo do formulário.
- [ ] **Mudança na Entrada de Tempo:** Substituir o campo "Quantidade de horas" por um input de `Data e hora de término`.
- [ ] **Descrição da Escala:** Adicionar um campo de texto (opcional) para o policial descrever a escala (ex: "Policiamento no Estádio").
- [ ] **Tipo de Escala:** Adicionar um seletor (dropdown) para definir o tipo de escala (quando necessário referenciar na tabela).
- [ ] **Lógica de Tempo:** Atualizar a função Javascript para calcular o total de horas automaticamente subtraindo a `Data/Hora de Término` da `Data/Hora de Início`.

## 2. Suporte a Múltiplas Escalas e Estado da Aplicação
- [ ] **Estrutura de Dados (JS):** Criar um estado no Javascript (ex: um *array* `escalas = []`) para armazenar as várias escalas lançadas.
- [ ] **Interface de Lista/Tabela:** Criar uma área na interface (uma tabela ou lista de cards) para exibir todas as escalas adicionadas na sessão.
- [ ] **Ações de CRUD Local:** Implementar botões para "Adicionar Escala" à lista e "Remover" uma escala da lista.
- [ ] **Cálculo Consolidado:** Atualizar a área de resultados para somar os valores e horas de *todas* as escalas inseridas na lista.

## 3. Importação da Agenda Google (.ics) (Módulo 3)
- [ ] **Upload de Arquivo:** Criar um botão/input de arquivo para receber o arquivo `.ics`.
- [ ] **Filtro de Datas:** Adicionar campos para o usuário definir o intervalo de datas (Data Inicial e Data Final) para a busca.
- [ ] **Parser e Lógica de Filtro:** Implementar a leitura do `.ics` no Javascript, extraindo os eventos e filtrando por palavras-chave (`AC4`, `extra`, `escala`, etc).
- [ ] **Tela de Revisão:** Mostrar ao usuário uma lista (pré-visualização) dos eventos encontrados no arquivo antes de consolidá-los na tabela principal, permitindo desmarcar os que ele não deseja importar.

## 4. Design Premium, UI e UX (Estética)
- [ ] **Paleta de Cores e Tipografia:** Atualizar o CSS para usar uma fonte moderna (como *Inter* via Google Fonts) e refinar os tons de verde, dourado e azul escuro para dar um aspecto mais solene e profissional.
- [ ] **Sombras e Cards (Glassmorphism/Modern UI):** Suavizar as bordas, aplicar sombras com profundidade e melhorar os contrastes.
- [ ] **Micro-interações:** Adicionar efeitos de transição suaves ao focar nos inputs (hover/focus) e animações na adição/remoção de escalas na lista.
- [ ] **Identidade neutra:** Garantir que a interface e o PDF não dependam de brasão específico ou vínculo visual direto a unidade específica.

## 5. Relatório e Impressão (Módulo 4)
- [ ] **Layout de Impressão (`@media print`):** Refazer o CSS de impressão. Ao invés de imprimir a tela da calculadora, o layout impresso deve assumir um formato de documento A4 claro e legível.
- [ ] **Cabeçalho do Relatório:** Garantir que o título neutro, a data de geração e o contexto do relatório apareçam de forma destacada no topo da folha impressa.
- [ ] **Tabela Impressa:** Formatar a lista de escalas como uma grade legível, com totais (diurno, noturno, valor) na parte inferior.
- [ ] **Rodapé Oficial:** Incluir a data e hora de geração do documento e o aviso legal de que se trata de uma simulação.
