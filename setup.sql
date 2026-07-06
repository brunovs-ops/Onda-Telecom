-- ============================================================
-- Onda Telecom - Setup do banco PostgreSQL (Railway)
-- Executar UMA VEZ na aba Data / Query do PostgreSQL do Railway
-- ============================================================

-- Limpa tudo se ja existir (permite re-executar sem erro)
DROP TABLE IF EXISTS chamados CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS cobertura_cep CASCADE;

-- ------------------------------------------------------------
-- Tabela CLIENTES
-- ------------------------------------------------------------
CREATE TABLE clientes (
  cpf VARCHAR(11) PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  plano VARCHAR(60) NOT NULL,
  status_linha VARCHAR(20) NOT NULL DEFAULT 'ativa',
  pre_pago BOOLEAN NOT NULL DEFAULT FALSE,
  franquia_total_gb NUMERIC(5,1),
  franquia_usada_gb NUMERIC(5,1),
  saldo VARCHAR(20),
  fatura_valor VARCHAR(20),
  fatura_vencimento VARCHAR(10),
  fatura_status VARCHAR(20),
  fatura_linha_digitavel VARCHAR(80),
  fatura_pix VARCHAR(200),
  endereco_rua VARCHAR(120),
  endereco_numero VARCHAR(10),
  endereco_bairro VARCHAR(60),
  endereco_cidade VARCHAR(60),
  endereco_uf VARCHAR(2),
  endereco_cep VARCHAR(9)
);

-- ------------------------------------------------------------
-- Tabela CHAMADOS
-- ------------------------------------------------------------
CREATE TABLE chamados (
  numero VARCHAR(20) PRIMARY KEY,
  cpf_cliente VARCHAR(11) NOT NULL REFERENCES clientes(cpf),
  assunto VARCHAR(200) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'aberto',
  data_agendada VARCHAR(10),
  periodo VARCHAR(20),
  endereco_atendimento VARCHAR(200),
  data_abertura TIMESTAMP NOT NULL DEFAULT NOW(),
  observacoes TEXT
);

CREATE INDEX idx_chamados_cpf ON chamados(cpf_cliente);

-- ------------------------------------------------------------
-- Tabela COBERTURA_CEP
-- ------------------------------------------------------------
CREATE TABLE cobertura_cep (
  cep VARCHAR(9) PRIMARY KEY,
  cidade VARCHAR(60),
  tem_4g BOOLEAN NOT NULL DEFAULT TRUE,
  tem_5g BOOLEAN NOT NULL DEFAULT FALSE,
  tem_fibra BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================================
-- DADOS FICTICIOS
-- ============================================================

-- ---- 5 CLIENTES ----
INSERT INTO clientes (
  cpf, nome, plano, status_linha, pre_pago,
  franquia_total_gb, franquia_usada_gb, saldo,
  fatura_valor, fatura_vencimento, fatura_status,
  fatura_linha_digitavel, fatura_pix,
  endereco_rua, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_cep
) VALUES
-- 1. Mariana - controle, fatura em aberto
('11144477735', 'Mariana Souza', 'Onda Controle 15GB', 'ativa', FALSE,
 15.0, 12.1, NULL,
 'R$ 79,90', '15/07/2026', 'EM ABERTO',
 '84670000001 6 79900000000 5 12345678901 2 34567890123 4',
 '00020126360014BR.GOV.BCB.PIX0114ondatelecom0215204000053039865802BR5910ONDA TELECOM6009SAO PAULO62070503***6304AB12',
 'Rua das Flores', '250', 'Vila Mariana', 'Sao Paulo', 'SP', '04101-000'),

-- 2. Carlos - pos, fatura paga
('22255588846', 'Carlos Pereira', 'Onda Pos 50GB', 'ativa', FALSE,
 50.0, 15.4, NULL,
 'R$ 129,90', '10/07/2026', 'PAGA',
 NULL, NULL,
 'Avenida Paulista', '1500', 'Bela Vista', 'Sao Paulo', 'SP', '01310-100'),

-- 3. Juliana - pre-pago
('33366699957', 'Juliana Lima', 'Onda Pre', 'ativa', TRUE,
 NULL, NULL, 'R$ 12,50',
 NULL, NULL, NULL, NULL, NULL,
 'Rua Amazonas', '78', 'Centro', 'Guarulhos', 'SP', '07010-000'),

-- 4. Ricardo - fibra, fatura em aberto
('44477700068', 'Ricardo Almeida', 'Onda Fibra 500Mega', 'ativa', FALSE,
 NULL, NULL, NULL,
 'R$ 149,90', '20/07/2026', 'EM ABERTO',
 '84670000002 3 14990000000 8 98765432109 1 76543210987 5',
 '00020126360014BR.GOV.BCB.PIX0114ondatelecom0215204000053039865802BR5910ONDA TELECOM6009SAO PAULO62070503***6304CD34',
 'Rua Bahia', '45', 'Jardim America', 'Sao Bernardo do Campo', 'SP', '09750-000'),

-- 5. BV (CPF do usuario, para teste)
('46556072893', 'Bruno Vieira', 'Onda Controle 25GB', 'ativa', FALSE,
 25.0, 8.2, NULL,
 'R$ 99,90', '18/07/2026', 'EM ABERTO',
 '84670000003 9 99900000000 4 55555444443 2 22221111199 8',
 '00020126360014BR.GOV.BCB.PIX0114ondatelecom0215204000053039865802BR5910ONDA TELECOM6009SAO PAULO62070503***6304EF56',
 'Rua Marechal Deodoro', '120', 'Centro', 'Sao Bernardo do Campo', 'SP', '09710-000');

-- ---- CHAMADOS HISTORICOS ----
INSERT INTO chamados (numero, cpf_cliente, assunto, status, data_agendada, periodo, endereco_atendimento, data_abertura, observacoes) VALUES
-- Mariana: instalacao em andamento
('OND-48213', '11144477735', 'Instalacao Onda Fibra', 'em andamento', '09/07/2026', 'manha', 'Rua das Flores, 250 - Vila Mariana - Sao Paulo/SP', '2026-06-28 10:15:00', 'Cliente solicitou instalacao nova.'),
('OND-46001', '11144477735', 'Troca de chip', 'concluido', '15/05/2026', 'tarde', 'Rua das Flores, 250 - Vila Mariana - Sao Paulo/SP', '2026-05-10 14:22:00', 'Chip trocado com sucesso.'),

-- Juliana: sem sinal, em analise
('OND-49001', '33366699957', 'Sem sinal na regiao', 'aberto', '07/07/2026', 'horario_comercial', 'Rua Amazonas, 78 - Centro - Guarulhos/SP', '2026-07-04 09:00:00', 'Cliente relata queda desde ontem.'),

-- Ricardo: internet lenta, concluido
('OND-47555', '44477700068', 'Internet lenta na Fibra', 'concluido', '20/06/2026', 'manha', 'Rua Bahia, 45 - Jardim America - Sao Bernardo do Campo/SP', '2026-06-18 16:00:00', 'Troca de cabo resolveu o problema.'),

-- BV: dois chamados
('OND-48800', '46556072893', 'Configuracao APN apos troca de chip', 'concluido', '02/07/2026', 'tarde', 'Rua Marechal Deodoro, 120 - Centro - Sao Bernardo do Campo/SP', '2026-06-30 11:00:00', 'Cliente conseguiu configurar.'),
('OND-49500', '46556072893', 'Instabilidade no 5G', 'em andamento', '08/07/2026', 'horario_comercial', 'Rua Marechal Deodoro, 120 - Centro - Sao Bernardo do Campo/SP', '2026-07-03 15:30:00', 'Em analise pela equipe tecnica.');

-- ---- COBERTURA DE CEPs ----
INSERT INTO cobertura_cep (cep, cidade, tem_4g, tem_5g, tem_fibra) VALUES
('04101-000', 'Sao Paulo', TRUE, TRUE, TRUE),
('01310-100', 'Sao Paulo', TRUE, TRUE, TRUE),
('07010-000', 'Guarulhos', TRUE, FALSE, TRUE),
('09750-000', 'Sao Bernardo do Campo', TRUE, TRUE, TRUE),
('09710-000', 'Sao Bernardo do Campo', TRUE, TRUE, TRUE),
('11060-000', 'Santos', TRUE, FALSE, TRUE),
('13010-000', 'Campinas', TRUE, TRUE, TRUE),
('20040-000', 'Rio de Janeiro', TRUE, TRUE, TRUE),
('30130-000', 'Belo Horizonte', TRUE, TRUE, TRUE),
('69900-000', 'Rio Branco', TRUE, FALSE, FALSE);

-- Fim
SELECT 'Setup concluido: ' || (SELECT COUNT(*) FROM clientes) || ' clientes, ' ||
       (SELECT COUNT(*) FROM chamados) || ' chamados, ' ||
       (SELECT COUNT(*) FROM cobertura_cep) || ' CEPs cadastrados.' AS resultado;
