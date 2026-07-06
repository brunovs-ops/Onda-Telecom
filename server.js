// ============================================================
// Servidor MCP - Onda Telecom v2 (com PostgreSQL / Railway)
// 8 tools: consulta, pagamento, protocolo, cobertura, agenda
// ============================================================

import express from "express";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ------------------------------------------------------------
// CONEXAO POSTGRES
// ------------------------------------------------------------
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : false,
});

// ------------------------------------------------------------
// AUTO-SETUP: executa setup.sql na primeira vez que sobe
// (verifica se a tabela 'clientes' existe; se nao, roda o SQL)
// ------------------------------------------------------------
async function autoSetup() {
  try {
    await pool.query("SELECT NOW()");
    console.log("PostgreSQL conectado com sucesso");

    const { rows } = await pool.query(
      "SELECT to_regclass('public.clientes') AS existe"
    );
    if (rows[0] && rows[0].existe) {
      console.log("Tabelas ja existem - nao vou recriar.");
      return;
    }

    console.log("Primeira execucao: aplicando setup.sql...");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sql = fs.readFileSync(path.join(__dirname, "setup.sql"), "utf8");
    await pool.query(sql);
    console.log("Setup do banco concluido!");
  } catch (err) {
    console.error("Erro no auto-setup:", err.message);
  }
}
autoSetup();

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
function normalizarCpf(cpf) {
  return String(cpf || "").replace(/\D/g, "");
}
function normalizarCep(cep) {
  const s = String(cep || "").replace(/\D/g, "");
  return s.length === 8 ? s.slice(0, 5) + "-" + s.slice(5) : s;
}
function txt(text, isError = false) {
  const res = { content: [{ type: "text", text }] };
  if (isError) res.isError = true;
  return res;
}
function gerarNumeroProtocolo() {
  return "OND-" + Math.floor(50000 + Math.random() * 9999);
}

const ERRO_CPF_NAO_ENCONTRADO =
  "Nao encontrei nenhuma conta com esse CPF. Peca ao cliente para confirmar os numeros do CPF. Se ainda assim nao localizar, ofereca encaminhar para um atendente humano.";

async function buscarCliente(cpf) {
  const { rows } = await pool.query(
    "SELECT * FROM clientes WHERE cpf = $1",
    [normalizarCpf(cpf)]
  );
  return rows[0] || null;
}

async function buscarChamado(numero) {
  const { rows } = await pool.query(
    "SELECT * FROM chamados WHERE numero = $1",
    [String(numero).toUpperCase().trim()]
  );
  return rows[0] || null;
}

// ------------------------------------------------------------
// FABRICA DO SERVIDOR MCP
// ------------------------------------------------------------
function criarServer() {
  const server = new McpServer({ name: "onda-telecom-mcp", version: "2.0.0" });

  // ============ TOOL 1: consultar_cliente ============
  server.registerTool(
    "consultar_cliente",
    {
      title: "Consultar cliente",
      description: `Retorna um retrato geral da conta do cliente a partir do CPF: nome, plano, status da linha, franquia de dados, resumo da fatura atual e o ultimo protocolo em aberto.

QUANDO USAR: cliente pergunta sobre "meu plano", "minha conta", "meus dados" de forma geral, ou quando precisa confirmar a situacao da conta antes de aprofundar.

COMO: cpf - com ou sem pontuacao.

RETORNA: dados reais da conta. Se CPF nao existir, retorna erro.

NAO USAR: para segunda via use gerar_segunda_via. Para status detalhado de chamado use consultar_protocolo.`,
      inputSchema: {
        cpf: z.string().describe("CPF do cliente, com ou sem pontuacao (11 digitos)"),
      },
    },
    async ({ cpf }) => {
      try {
        const c = await buscarCliente(cpf);
        if (!c) return txt(ERRO_CPF_NAO_ENCONTRADO, true);

        const linhas = [
          `Cliente localizado: ${c.nome}.`,
          `Plano: ${c.plano}.`,
          `Status da linha: ${c.status_linha}.`,
        ];

        if (c.pre_pago) {
          linhas.push(`Modalidade pre-pago. Saldo atual: ${c.saldo}.`);
        } else if (c.franquia_total_gb) {
          const usada = Number(c.franquia_usada_gb);
          const total = Number(c.franquia_total_gb);
          const restante = (total - usada).toFixed(1);
          const pct = Math.round((usada / total) * 100);
          linhas.push(
            `Franquia de dados: ${usada} GB usados de ${total} GB (${pct}%). Restam ${restante} GB neste ciclo.`
          );
        }

        if (c.fatura_valor) {
          linhas.push(
            `Fatura atual: ${c.fatura_valor}, vencimento ${c.fatura_vencimento}, status ${c.fatura_status}.`
          );
        }

        // Ultimo chamado
        const { rows: chamados } = await pool.query(
          "SELECT numero, assunto, status FROM chamados WHERE cpf_cliente = $1 ORDER BY data_abertura DESC LIMIT 1",
          [normalizarCpf(cpf)]
        );
        if (chamados[0]) {
          linhas.push(
            `Ultimo protocolo: ${chamados[0].numero} (${chamados[0].assunto}) - ${chamados[0].status}.`
          );
        } else {
          linhas.push("Nao ha protocolos registrados.");
        }

        return txt(linhas.join("\n"));
      } catch (err) {
        console.error(err);
        return txt("Erro ao consultar a base de dados. Tente novamente em instantes.", true);
      }
    }
  );

  // ============ TOOL 2: gerar_segunda_via ============
  server.registerTool(
    "gerar_segunda_via",
    {
      title: "Gerar segunda via da fatura",
      description: `Gera a segunda via da fatura atual do cliente com valor, vencimento, linha digitavel e Pix.

QUANDO USAR: cliente pede "segunda via", "quero pagar minha fatura", "linha digitavel", "codigo Pix".

COMO: cpf - com ou sem pontuacao.

RETORNA: dados de pagamento. Se fatura ja estiver paga, informa. Se for pre-pago, informa que nao ha fatura.`,
      inputSchema: {
        cpf: z.string().describe("CPF do cliente (11 digitos)"),
      },
    },
    async ({ cpf }) => {
      try {
        const c = await buscarCliente(cpf);
        if (!c) return txt(ERRO_CPF_NAO_ENCONTRADO, true);

        if (c.pre_pago) {
          return txt(
            `${c.nome} esta na modalidade pre-pago, entao nao ha fatura para segunda via. Saldo atual: ${c.saldo}.`
          );
        }
        if (!c.fatura_valor || c.fatura_status === "PAGA") {
          return txt(
            `A fatura mais recente de ${c.nome} consta como PAGA${c.fatura_valor ? " (" + c.fatura_valor + ", venc. " + c.fatura_vencimento + ")" : ""}. Nao ha valor em aberto para gerar segunda via no momento.`
          );
        }

        return txt(
          [
            `Segunda via da fatura de ${c.nome}:`,
            `Valor: ${c.fatura_valor}`,
            `Vencimento: ${c.fatura_vencimento}`,
            `Status: ${c.fatura_status}`,
            `Linha digitavel: ${c.fatura_linha_digitavel}`,
            `Pix copia e cola: ${c.fatura_pix}`,
            `Oriente o cliente a pagar por qualquer um dos meios acima. A compensacao do Pix e quase imediata.`,
          ].join("\n")
        );
      } catch (err) {
        console.error(err);
        return txt("Erro ao consultar a base de dados.", true);
      }
    }
  );

  // ============ TOOL 3: consultar_protocolo ============
  server.registerTool(
    "consultar_protocolo",
    {
      title: "Consultar ultimo protocolo",
      description: `Retorna o status detalhado do ULTIMO chamado do cliente (mais recente) a partir do CPF.

QUANDO USAR: cliente pergunta "meu chamado", "meu protocolo", "status da instalacao", "andamento do meu pedido".

COMO: cpf - com ou sem pontuacao.

NAO USAR: para ver TODOS os chamados use listar_historico_chamados. Para abrir novo use abrir_chamado.`,
      inputSchema: {
        cpf: z.string().describe("CPF do cliente (11 digitos)"),
      },
    },
    async ({ cpf }) => {
      try {
        const c = await buscarCliente(cpf);
        if (!c) return txt(ERRO_CPF_NAO_ENCONTRADO, true);

        const { rows } = await pool.query(
          "SELECT * FROM chamados WHERE cpf_cliente = $1 ORDER BY data_abertura DESC LIMIT 1",
          [normalizarCpf(cpf)]
        );
        if (!rows[0]) return txt(`${c.nome} nao possui nenhum protocolo/chamado registrado.`);
        const p = rows[0];
        return txt(
          [
            `Ultimo protocolo de ${c.nome}:`,
            `Numero: ${p.numero}`,
            `Assunto: ${p.assunto}`,
            `Status: ${p.status}`,
            `Data agendada: ${p.data_agendada || "nao agendada"}`,
            `Periodo: ${p.periodo || "nao definido"}`,
            `Endereco de atendimento: ${p.endereco_atendimento || "-"}`,
          ].join("\n")
        );
      } catch (err) {
        console.error(err);
        return txt("Erro ao consultar a base de dados.", true);
      }
    }
  );

  // ============ TOOL 4: abrir_chamado ============
  server.registerTool(
    "abrir_chamado",
    {
      title: "Abrir chamado tecnico com agendamento",
      description: `Abre um novo chamado tecnico para o cliente COM agendamento de visita e retorna o numero do protocolo. Esta acao CRIA um registro novo.

QUANDO USAR: apos troubleshooting sem sucesso e com aval do cliente para abrir chamado. IMPORTANTE: colete TODOS os dados abaixo antes de chamar esta ferramenta.

DADOS OBRIGATORIOS a coletar do cliente antes de chamar:
- cpf (do cliente)
- assunto (resumo do problema)
- data_agendada (formato DD/MM/AAAA - confirme com o cliente)
- periodo (um destes: "manha", "tarde", "horario_comercial")
- endereco_atendimento (rua, numero, bairro, cidade/UF - confirme com o cliente, sugerindo o endereco cadastrado que aparece em consultar_cliente)

RETORNA: numero do protocolo criado e confirmacao do agendamento.`,
      inputSchema: {
        cpf: z.string().describe("CPF do cliente"),
        assunto: z.string().min(3).describe("Resumo curto do problema"),
        data_agendada: z.string().describe("Data da visita no formato DD/MM/AAAA"),
        periodo: z.enum(["manha", "tarde", "horario_comercial"]).describe("Periodo da visita"),
        endereco_atendimento: z.string().min(10).describe("Endereco completo para atendimento"),
      },
    },
    async ({ cpf, assunto, data_agendada, periodo, endereco_atendimento }) => {
      try {
        const c = await buscarCliente(cpf);
        if (!c) return txt(ERRO_CPF_NAO_ENCONTRADO, true);
        const numero = gerarNumeroProtocolo();
        await pool.query(
          `INSERT INTO chamados (numero, cpf_cliente, assunto, status, data_agendada, periodo, endereco_atendimento)
           VALUES ($1, $2, $3, 'aberto', $4, $5, $6)`,
          [numero, normalizarCpf(cpf), assunto, data_agendada, periodo, endereco_atendimento]
        );
        return txt(
          [
            `Chamado aberto com sucesso para ${c.nome}!`,
            `Numero do protocolo: ${numero}`,
            `Assunto: ${assunto}`,
            `Data agendada: ${data_agendada} (${periodo.replace("_", " ")})`,
            `Endereco: ${endereco_atendimento}`,
            `Status: aberto`,
            `Um tecnico entrara em contato para confirmar a visita. Informe o numero do protocolo ao cliente.`,
          ].join("\n")
        );
      } catch (err) {
        console.error(err);
        return txt("Erro ao registrar o chamado. Tente novamente.", true);
      }
    }
  );

  // ============ TOOL 5: listar_historico_chamados ============
  server.registerTool(
    "listar_historico_chamados",
    {
      title: "Listar historico de chamados",
      description: `Lista TODOS os chamados/protocolos do cliente (historico completo), do mais recente ao mais antigo.

QUANDO USAR: cliente pergunta sobre "todos os meus chamados", "historico", "meus atendimentos anteriores".

COMO: cpf - com ou sem pontuacao.

NAO USAR: para so o ultimo chamado use consultar_protocolo.`,
      inputSchema: {
        cpf: z.string().describe("CPF do cliente (11 digitos)"),
      },
    },
    async ({ cpf }) => {
      try {
        const c = await buscarCliente(cpf);
        if (!c) return txt(ERRO_CPF_NAO_ENCONTRADO, true);
        const { rows } = await pool.query(
          "SELECT numero, assunto, status, data_agendada FROM chamados WHERE cpf_cliente = $1 ORDER BY data_abertura DESC",
          [normalizarCpf(cpf)]
        );
        if (rows.length === 0) return txt(`${c.nome} nao possui chamados no historico.`);
        const linhas = [`Historico de chamados de ${c.nome} (${rows.length} registros):`];
        rows.forEach((p, i) => {
          linhas.push(
            `${i + 1}. ${p.numero} - ${p.assunto} - status: ${p.status} - agendado: ${p.data_agendada || "-"}`
          );
        });
        return txt(linhas.join("\n"));
      } catch (err) {
        console.error(err);
        return txt("Erro ao consultar a base de dados.", true);
      }
    }
  );

  // ============ TOOL 6: cancelar_chamado ============
  server.registerTool(
    "cancelar_chamado",
    {
      title: "Cancelar chamado",
      description: `Cancela um chamado existente a partir do numero do protocolo. Esta acao ALTERA o status para 'cancelado'.

QUANDO USAR: cliente pede para cancelar um chamado especifico. Confirme com o cliente antes de executar.

COMO: numero_protocolo (formato OND-XXXXX).

NAO PODE cancelar chamados ja concluidos.`,
      inputSchema: {
        numero_protocolo: z.string().describe("Numero do protocolo, ex.: OND-49500"),
      },
    },
    async ({ numero_protocolo }) => {
      try {
        const p = await buscarChamado(numero_protocolo);
        if (!p) return txt(`Protocolo ${numero_protocolo} nao encontrado. Confirme o numero.`, true);
        if (p.status === "concluido") return txt(`O chamado ${p.numero} ja esta concluido e nao pode ser cancelado.`, true);
        if (p.status === "cancelado") return txt(`O chamado ${p.numero} ja estava cancelado.`);
        await pool.query("UPDATE chamados SET status = 'cancelado' WHERE numero = $1", [p.numero]);
        return txt(`Chamado ${p.numero} (${p.assunto}) cancelado com sucesso. Confirme o cancelamento com o cliente.`);
      } catch (err) {
        console.error(err);
        return txt("Erro ao cancelar chamado.", true);
      }
    }
  );

  // ============ TOOL 7: reagendar_chamado ============
  server.registerTool(
    "reagendar_chamado",
    {
      title: "Reagendar chamado",
      description: `Altera a data e/ou periodo de um chamado ja existente. Esta acao ATUALIZA o registro.

QUANDO USAR: cliente pede para trocar a data ou horario de uma visita agendada. Confirme os novos dados com o cliente.

COMO:
- numero_protocolo (formato OND-XXXXX)
- nova_data (DD/MM/AAAA)
- novo_periodo (manha, tarde, horario_comercial)

NAO PODE reagendar chamados concluidos ou cancelados.`,
      inputSchema: {
        numero_protocolo: z.string().describe("Numero do protocolo, ex.: OND-49500"),
        nova_data: z.string().describe("Nova data no formato DD/MM/AAAA"),
        novo_periodo: z.enum(["manha", "tarde", "horario_comercial"]).describe("Novo periodo"),
      },
    },
    async ({ numero_protocolo, nova_data, novo_periodo }) => {
      try {
        const p = await buscarChamado(numero_protocolo);
        if (!p) return txt(`Protocolo ${numero_protocolo} nao encontrado.`, true);
        if (p.status === "concluido" || p.status === "cancelado")
          return txt(`Nao e possivel reagendar um chamado com status "${p.status}".`, true);
        await pool.query(
          "UPDATE chamados SET data_agendada = $1, periodo = $2 WHERE numero = $3",
          [nova_data, novo_periodo, p.numero]
        );
        return txt(
          `Chamado ${p.numero} reagendado com sucesso para ${nova_data} (${novo_periodo.replace("_", " ")}). Confirme com o cliente.`
        );
      } catch (err) {
        console.error(err);
        return txt("Erro ao reagendar chamado.", true);
      }
    }
  );

  // ============ TOOL 8: consultar_cobertura ============
  server.registerTool(
    "consultar_cobertura",
    {
      title: "Consultar cobertura por CEP",
      description: `Verifica se um CEP tem cobertura Onda e quais tecnologias estao disponiveis (4G, 5G, Fibra).

QUANDO USAR: cliente pergunta se tem cobertura no seu endereco/CEP, ou se pode contratar Fibra na regiao. Tambem util para validar viabilidade antes de abrir chamado de instalacao.

COMO: cep - com ou sem hifen.

RETORNA: cidade e tecnologias disponiveis. Se nao coberto, informa.`,
      inputSchema: {
        cep: z.string().describe("CEP no formato 00000-000 ou 00000000"),
      },
    },
    async ({ cep }) => {
      try {
        const cepFmt = normalizarCep(cep);
        const { rows } = await pool.query("SELECT * FROM cobertura_cep WHERE cep = $1", [cepFmt]);
        if (!rows[0]) {
          return txt(
            `O CEP ${cepFmt} nao consta na base de cobertura da Onda. Isso NAO significa necessariamente que nao ha cobertura - oriente o cliente a checar tambem no app Onda ou fale com um especialista para uma consulta detalhada.`
          );
        }
        const c = rows[0];
        const tecnologias = [];
        if (c.tem_4g) tecnologias.push("4G");
        if (c.tem_5g) tecnologias.push("5G");
        if (c.tem_fibra) tecnologias.push("Onda Fibra");
        return txt(
          `CEP ${cepFmt} (${c.cidade}) tem cobertura Onda com: ${tecnologias.join(", ")}.`
        );
      } catch (err) {
        console.error(err);
        return txt("Erro ao consultar cobertura.", true);
      }
    }
  );

  return server;
}

// ------------------------------------------------------------
// SERVIDOR HTTP
// ------------------------------------------------------------
const app = express();
app.use(express.json());

const API_KEY = process.env.MCP_API_KEY;

app.get("/", (_req, res) => {
  res.send("Onda Telecom MCP v2 (com PostgreSQL) - OK. Endpoint MCP: POST /mcp");
});

app.post("/mcp", async (req, res) => {
  if (API_KEY && req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  }
  try {
    const server = criarServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Erro no MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Use POST." }, id: null });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Onda Telecom MCP v2 rodando na porta ${PORT}`);
  console.log(API_KEY ? "Autenticacao: header x-api-key ATIVA" : "Autenticacao: NENHUMA");
});
