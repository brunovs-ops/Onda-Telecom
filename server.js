// ============================================================
// Servidor MCP - Onda Telecom (cenario ficticio / exercicio Moveo.ai)
// Transporte: Streamable HTTP (stateless), conforme exigido pela Moveo.
// SDK: @modelcontextprotocol/sdk (v1.x) + Express + Zod
// ============================================================

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ------------------------------------------------------------
// BASE DE DADOS FICTICIA
// (em memoria - suficiente para a demo; em producao seria PostgreSQL/CRM)
// ------------------------------------------------------------
const CLIENTES = {
  "46556072893": {
    nome: "Mariana Souza",
    plano: "Onda Controle 15GB",
    statusLinha: "ativa",
    franquiaTotalGb: 15,
    franquiaUsadaGb: 12.1,
    fatura: {
      valor: "R$ 79,90",
      vencimento: "15/07/2026",
      status: "EM ABERTO",
      linhaDigitavel: "84670000001 6 79900000000 5 12345678901 2 34567890123 4",
      pixCopiaECola: "00020126360014BR.GOV.BCB.PIX0114ondatelecom0215204000053039865802BR5910ONDA TELECOM6009SAO PAULO62070503***6304AB12",
    },
    protocolo: {
      numero: "OND-48213",
      assunto: "Instalacao Onda Fibra",
      status: "em andamento",
      previsao: "09/07/2026",
    },
  },
  "22255588846": {
    nome: "Carlos Pereira",
    plano: "Onda Pos 50GB",
    statusLinha: "ativa",
    franquiaTotalGb: 50,
    franquiaUsadaGb: 15.4,
    fatura: {
      valor: "R$ 129,90",
      vencimento: "10/07/2026",
      status: "PAGA",
    },
    protocolo: null,
  },
  "33366699957": {
    nome: "Juliana Lima",
    plano: "Onda Pre",
    statusLinha: "ativa",
    prePago: true,
    saldo: "R$ 12,50",
    protocolo: {
      numero: "OND-49001",
      assunto: "Sem sinal na regiao",
      status: "aberto (em analise)",
      previsao: "07/07/2026",
    },
  },
};

// Remove pontuacao do CPF: aceita "111.444.777-35" ou "11144477735"
function normalizarCpf(cpf) {
  return String(cpf || "").replace(/\D/g, "");
}

function buscarCliente(cpf) {
  return CLIENTES[normalizarCpf(cpf)] || null;
}

function txt(text, isError = false) {
  const res = { content: [{ type: "text", text }] };
  if (isError) res.isError = true;
  return res;
}

const ERRO_CPF_NAO_ENCONTRADO =
  "Nao encontrei nenhuma conta com esse CPF. Peca ao cliente para confirmar os numeros do CPF. Se ainda assim nao localizar, ofereca encaminhar para um atendente humano.";

// ------------------------------------------------------------
// FABRICA DO SERVIDOR MCP (uma instancia nova por request = stateless)
// ------------------------------------------------------------
function criarServer() {
  const server = new McpServer({
    name: "onda-telecom-mcp",
    version: "1.0.0",
  });

  // ---- TOOL 1: consultar_cliente ----
  server.registerTool(
    "consultar_cliente",
    {
      title: "Consultar cliente",
      description: `Retorna um retrato geral da conta do cliente a partir do CPF: nome, plano, status da linha, franquia de dados, resumo da fatura atual e o ultimo protocolo em aberto.

QUANDO USAR:
- O cliente pergunta sobre "meu plano", "minha conta", "meus dados" de forma geral.
- Precisa confirmar a situacao da conta antes de aprofundar em fatura ou protocolo.

COMO:
- cpf: CPF do cliente, com ou sem pontuacao.

RETORNA: dados reais da conta. Se o CPF nao existir, retorna erro pedindo para confirmar o CPF.

NAO USAR: para gerar a segunda via ou a linha digitavel de pagamento use gerar_segunda_via. Para o status detalhado de um chamado use consultar_protocolo. Para abrir um novo chamado use abrir_chamado.`,
      inputSchema: {
        cpf: z
          .string()
          .describe("CPF do cliente, com ou sem pontuacao (11 digitos)"),
      },
    },
    async ({ cpf }) => {
      const c = buscarCliente(cpf);
      if (!c) return txt(ERRO_CPF_NAO_ENCONTRADO, true);

      const linhas = [`Cliente localizado: ${c.nome}.`, `Plano: ${c.plano}.`, `Status da linha: ${c.statusLinha}.`];

      if (c.prePago) {
        linhas.push(`Modalidade pre-pago. Saldo atual: ${c.saldo}.`);
      } else {
        const restante = (c.franquiaTotalGb - c.franquiaUsadaGb).toFixed(1);
        const pct = Math.round((c.franquiaUsadaGb / c.franquiaTotalGb) * 100);
        linhas.push(
          `Franquia de dados: ${c.franquiaUsadaGb} GB usados de ${c.franquiaTotalGb} GB (${pct}%). Restam ${restante} GB neste ciclo.`
        );
        if (c.fatura) {
          linhas.push(
            `Fatura atual: ${c.fatura.valor}, vencimento ${c.fatura.vencimento}, status ${c.fatura.status}.`
          );
        }
      }

      if (c.protocolo) {
        linhas.push(
          `Ultimo protocolo: ${c.protocolo.numero} (${c.protocolo.assunto}) - ${c.protocolo.status}.`
        );
      } else {
        linhas.push("Nao ha protocolos em aberto.");
      }

      return txt(linhas.join("\n"));
    }
  );

  // ---- TOOL 2: gerar_segunda_via ----
  server.registerTool(
    "gerar_segunda_via",
    {
      title: "Gerar segunda via da fatura",
      description: `Gera a segunda via da fatura atual do cliente a partir do CPF, com valor, vencimento, status, linha digitavel do boleto e codigo Pix copia-e-cola.

QUANDO USAR:
- O cliente pede a "segunda via", quer "pagar a fatura", pede a "linha digitavel" ou o "codigo Pix".

COMO:
- cpf: CPF do cliente, com ou sem pontuacao.

RETORNA: dados de pagamento da fatura em aberto. Se a fatura ja estiver paga, informa isso. Se for pre-pago, informa que nao ha fatura.

NAO USAR: para um retrato geral da conta use consultar_cliente.`,
      inputSchema: {
        cpf: z
          .string()
          .describe("CPF do cliente, com ou sem pontuacao (11 digitos)"),
      },
    },
    async ({ cpf }) => {
      const c = buscarCliente(cpf);
      if (!c) return txt(ERRO_CPF_NAO_ENCONTRADO, true);

      if (c.prePago) {
        return txt(
          `${c.nome} esta na modalidade pre-pago, entao nao ha fatura para segunda via. O cliente usa creditos por recarga. Saldo atual: ${c.saldo}.`
        );
      }
      if (!c.fatura || c.fatura.status === "PAGA") {
        return txt(
          `A fatura mais recente de ${c.nome} consta como PAGA (${c.fatura ? c.fatura.valor + ", venc. " + c.fatura.vencimento : "sem valor em aberto"}). Nao ha valor em aberto para gerar segunda via no momento.`
        );
      }

      return txt(
        [
          `Segunda via da fatura de ${c.nome}:`,
          `Valor: ${c.fatura.valor}`,
          `Vencimento: ${c.fatura.vencimento}`,
          `Status: ${c.fatura.status}`,
          `Linha digitavel: ${c.fatura.linhaDigitavel}`,
          `Pix copia e cola: ${c.fatura.pixCopiaECola}`,
          `Oriente o cliente a pagar por qualquer um dos meios acima. A compensacao do Pix e quase imediata.`,
        ].join("\n")
      );
    }
  );

  // ---- TOOL 3: consultar_protocolo ----
  server.registerTool(
    "consultar_protocolo",
    {
      title: "Consultar protocolo / chamado",
      description: `Retorna o status detalhado do ultimo chamado (protocolo) do cliente a partir do CPF: numero, assunto, status e previsao.

QUANDO USAR:
- O cliente pergunta sobre "meu chamado", "meu protocolo", "status da instalacao", "andamento do meu pedido".

COMO:
- cpf: CPF do cliente, com ou sem pontuacao.

RETORNA: dados do protocolo em aberto. Se nao houver protocolo, informa isso.

NAO USAR: para abrir um novo chamado use abrir_chamado.`,
      inputSchema: {
        cpf: z
          .string()
          .describe("CPF do cliente, com ou sem pontuacao (11 digitos)"),
      },
    },
    async ({ cpf }) => {
      const c = buscarCliente(cpf);
      if (!c) return txt(ERRO_CPF_NAO_ENCONTRADO, true);
      if (!c.protocolo) {
        return txt(`${c.nome} nao possui nenhum protocolo/chamado em aberto no momento.`);
      }
      return txt(
        [
          `Protocolo de ${c.nome}:`,
          `Numero: ${c.protocolo.numero}`,
          `Assunto: ${c.protocolo.assunto}`,
          `Status: ${c.protocolo.status}`,
          `Previsao de conclusao: ${c.protocolo.previsao}`,
        ].join("\n")
      );
    }
  );

  // ---- TOOL 4: abrir_chamado (acao com efeito) ----
  server.registerTool(
    "abrir_chamado",
    {
      title: "Abrir chamado tecnico",
      description: `Abre um novo chamado de suporte tecnico para o cliente e retorna o numero de protocolo gerado. Esta acao CRIA um registro novo.

QUANDO USAR:
- Depois de tentar o troubleshooting basico sem sucesso e o cliente concordar em abrir um chamado (ex.: sem sinal, internet fora do ar, falha na linha).

COMO:
- cpf: CPF do cliente.
- assunto: resumo curto do problema (ex.: "sem sinal", "internet fora do ar").

RETORNA: numero do protocolo e prazo de atendimento. Confirme o problema com o cliente antes de chamar esta ferramenta.

NAO USAR: para apenas consultar um chamado existente use consultar_protocolo.`,
      inputSchema: {
        cpf: z.string().describe("CPF do cliente, com ou sem pontuacao (11 digitos)"),
        assunto: z
          .string()
          .min(3)
          .describe("Resumo curto do problema relatado pelo cliente"),
      },
    },
    async ({ cpf, assunto }) => {
      const c = buscarCliente(cpf);
      if (!c) return txt(ERRO_CPF_NAO_ENCONTRADO, true);
      const numero = "OND-" + Math.floor(50000 + Math.random() * 9999);
      return txt(
        [
          `Chamado aberto com sucesso para ${c.nome}.`,
          `Numero do protocolo: ${numero}`,
          `Assunto: ${assunto}`,
          `Status: aberto`,
          `Prazo de retorno: ate 48 horas uteis.`,
          `Informe o numero do protocolo ao cliente para acompanhamento.`,
        ].join("\n")
      );
    }
  );

  return server;
}

// ------------------------------------------------------------
// SERVIDOR HTTP (Express)
// ------------------------------------------------------------
const app = express();
app.use(express.json());

// Autenticacao opcional por header (x-api-key).
// Se a variavel MCP_API_KEY estiver definida, o header e obrigatorio.
// Se nao estiver definida, o servidor fica publico (Moveo detecta "None").
const API_KEY = process.env.MCP_API_KEY;

// Healthcheck simples (abra no navegador para confirmar que subiu)
app.get("/", (_req, res) => {
  res.send("Onda Telecom MCP server - OK. Endpoint MCP: POST /mcp");
});

// Endpoint MCP (Streamable HTTP)
app.post("/mcp", async (req, res) => {
  if (API_KEY && req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
  }
  try {
    const server = criarServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: sem sessao persistida
      enableJsonResponse: true, // responde JSON puro (sem stream SSE)
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Erro ao processar request MCP:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET /mcp nao e usado (sem stream SSE) -> 405
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Use POST." },
    id: null,
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Onda Telecom MCP server rodando na porta ${PORT}`);
  console.log(API_KEY ? "Autenticacao: header x-api-key ATIVA" : "Autenticacao: NENHUMA (servidor publico)");
});
