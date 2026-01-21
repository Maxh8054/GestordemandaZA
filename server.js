// server.js - Versão Completa com Suporte às Novas Funcionalidades e Correções
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração CORS para Render e desenvolvimento
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://0.0.0.0:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json({ limit: '50mb' })); // Aumentado para 50mb para importações grandes
app.use(express.static('.'));

// Middleware de rate limiting simples
const requestCounts = {};
const RATE_LIMIT = 100; // máximo 100 requisições por minuto
const WINDOW_MS = 60000; // 1 minuto

app.use((req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    
    if (!requestCounts[key]) {
        requestCounts[key] = { count: 0, resetTime: now + WINDOW_MS };
    }
    
    if (now > requestCounts[key].resetTime) {
        requestCounts[key] = { count: 0, resetTime: now + WINDOW_MS };
    }
    
    requestCounts[key].count++;
    
    if (requestCounts[key].count > RATE_LIMIT) {
        return res.status(429).json({ 
            success: false, 
            error: 'Muitas requisições. Por favor, aguarde um momento.' 
        });
    }
    
    next();
});

// Middleware de logging simples
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url} - IP: ${req.ip}`);
    next();
});

// Criar diretório para backups se não existir
const backupDir = path.join(__dirname, 'backups');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

// Criar/abrir banco de dados SQLite
const DB_FILE = path.join(__dirname, 'demandas.db');
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) return console.error('❌ Erro ao abrir o banco de dados:', err);
    console.log('✅ Banco de dados SQLite pronto!');
    inicializarBancoDados();
});

// Habilitar chaves estrangeiras
db.run('PRAGMA foreign_keys = ON');
// Configurar timeout maior para operações longas
db.run('PRAGMA busy_timeout = 30000'); // 30 segundos

// Função para inicializar o banco de dados
function inicializarBancoDados() {
    // Tabela de demandas com índices
    db.run(`
    CREATE TABLE IF NOT EXISTS demandas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionarioId INTEGER NOT NULL,
    nomeFuncionario TEXT NOT NULL,
    emailFuncionario TEXT NOT NULL,
    categoria TEXT NOT NULL,
    prioridade TEXT NOT NULL,
    complexidade TEXT NOT NULL,
    descricao TEXT NOT NULL,
    local TEXT NOT NULL,
    dataCriacao TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dataLimite TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    isRotina INTEGER DEFAULT 0,
    diasSemana TEXT,
    tag TEXT UNIQUE,
    comentarios TEXT DEFAULT '',
    comentarioGestor TEXT DEFAULT '',
    dataConclusao TEXT,
    atribuidos TEXT DEFAULT '[]',
    anexosCriacao TEXT DEFAULT '[]',
    anexosResolucao TEXT DEFAULT '[]',
    comentarioReprovacaoAtribuicao TEXT DEFAULT '',
    nomeDemanda TEXT,
    dataAtualizacao TEXT DEFAULT CURRENT_TIMESTAMP,
    criadoPor INTEGER,
    atualizadoPor INTEGER,
    comentariosUsuarios TEXT DEFAULT '[]'
    )
    `, (err) => {
        if (err) console.error('Erro ao criar tabela demandas:', err);
        else {
            console.log('✅ Tabela demandas criada/verificada');
            criarIndices();
            adicionarColunaComentariosUsuarios();
        }
    });
}

// Função para adicionar a coluna comentariosUsuarios se não existir
function adicionarColunaComentariosUsuarios() {
    db.all("PRAGMA table_info(demandas)", [], (err, columns) => {
        if (err) {
            console.error('Erro ao verificar colunas da tabela:', err);
            return;
        }
        
        const hasComentariosUsuarios = columns.some(col => col.name === 'comentariosUsuarios');
        
        if (!hasComentariosUsuarios) {
            db.run("ALTER TABLE demandas ADD COLUMN comentariosUsuarios TEXT DEFAULT '[]'", (err) => {
                if (err) {
                    console.error('Erro ao adicionar coluna comentariosUsuarios:', err);
                } else {
                    console.log('✅ Coluna comentariosUsuarios adicionada com sucesso');
                }
            });
        }
    });
}

// Criar índices para performance
function criarIndices() {
    const indices = [
        'CREATE INDEX IF NOT EXISTS idx_status ON demandas(status)',
        'CREATE INDEX IF NOT EXISTS idx_funcionarioId ON demandas(funcionarioId)',
        'CREATE INDEX IF NOT EXISTS idx_dataLimite ON demandas(dataLimite)',
        'CREATE INDEX IF NOT EXISTS idx_tag ON demandas(tag)',
        'CREATE INDEX IF NOT EXISTS idx_categoria ON demandas(categoria)',
        'CREATE INDEX IF NOT EXISTS idx_prioridade ON demandas(prioridade)',
        'CREATE INDEX IF NOT EXISTS idx_dataCriacao ON demandas(dataCriacao)'
    ];

    let completed = 0;
    indices.forEach(sql => {
        db.run(sql, (err) => {
            if (err) console.error('Erro ao criar índice:', err);
            else {
                completed++;
                if (completed === indices.length) {
                    console.log('✅ Índices criados/verificados');
                    criarTabelaUsuarios();
                }
            }
        });
    });
}

// Tabela de usuários
function criarTabelaUsuarios() {
    db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    nome TEXT UNIQUE,
    email TEXT UNIQUE,
    senha TEXT,
    nivel TEXT,
    pontos INTEGER DEFAULT 0,
    conquistas TEXT DEFAULT '[]',
    role TEXT DEFAULT 'funcionario'
    )
    `, (err) => {
        if (err) console.error('Erro ao criar tabela usuarios:', err);
        else {
            console.log('✅ Tabela usuarios criada/verificada');
            criarTabelaAuditoria();
        }
    });
}

// Tabela de auditoria
function criarTabelaAuditoria() {
    db.run(`
    CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acao TEXT NOT NULL,
    tabela TEXT NOT NULL,
    registroId INTEGER NOT NULL,
    dadosAntigos TEXT,
    dadosNovos TEXT,
    usuarioId INTEGER,
    dataHora TEXT DEFAULT CURRENT_TIMESTAMP,
    ip TEXT
    )
    `, (err) => {
        if (err) console.error('Erro ao criar tabela auditoria:', err);
        else {
            console.log('✅ Tabela auditoria criada/verificada');
            criarTabelaFeedbacks();
        }
    });
}

// Tabela de feedbacks
function criarTabelaFeedbacks() {
    db.run(`
    CREATE TABLE IF NOT EXISTS feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionarioId INTEGER,
    gestorId INTEGER,
    tipo TEXT,
    mensagem TEXT,
    dataCriacao TEXT
    )
    `, (err) => {
        if (err) console.error('Erro ao criar tabela feedbacks:', err);
        else {
            console.log('✅ Tabela feedbacks criada/verificada');
            criarTabelaAnotacoes();
        }
    });
}

// Tabela de anotações
function criarTabelaAnotacoes() {
    db.run(`
    CREATE TABLE IF NOT EXISTS anotacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    conteudo TEXT NOT NULL,
    cor TEXT DEFAULT '#3498db',
    dataCriacao TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criadoPor INTEGER NOT NULL,
    atribuidoA INTEGER,
    audioData TEXT,
    atualizadoEm TEXT DEFAULT CURRENT_TIMESTAMP
    )
    `, (err) => {
        if (err) console.error('Erro ao criar tabela anotacoes:', err);
        else {
            console.log('✅ Tabela anotacoes criada/verificada');
            inserirUsuariosPadrao();
        }
    });
}

// Inserir usuários padrão
function inserirUsuariosPadrao() {
    const usuariosPadrao = [
        { id: 1, nome: 'Ranielly Miranda De Souza', email: 'ranielly-s@zaminebrasil.com', nivel: 'Senior', pontos: 450, conquistas: '["star", "fire", "gold"]', senha: '123456', role: 'funcionario' },
        { id: 2, nome: 'Girlene da Silva Nogueira', email: 'girlene-n@zaminebrasil.com', nivel: 'Pleno', pontos: 380, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 3, nome: 'Rafaela Cristine da Silva Martins', email: 'rafaela-m@zaminebrasil.com', nivel: 'Senior', pontos: 520, conquistas: '["star", "fire", "gold"]', senha: '123456', role: 'funcionario' },
        { id: 5, nome: 'Marcos Antônio Lino Rosa', email: 'marcos-a@zaminebrasil.com', nivel: 'Junior', pontos: 280, conquistas: '["star"]', senha: '123456', role: 'funcionario' },
        { id: 6, nome: 'Marcos Paulo Moraes Borges', email: 'marcos-b@zaminebrasil.com', nivel: 'Pleno', pontos: 410, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 7, nome: 'Marcelo Goncalves de Paula', email: 'marcelo-p@zaminebrasil.com', nivel: 'Senior', pontos: 480, conquistas: '["star", "fire", "gold"]', senha: '123456', role: 'funcionario' },
        { id: 8, nome: 'Higor Ataides Macedo', email: 'higor-a@zaminebrasil.com', nivel: 'Junior', pontos: 250, conquistas: '["star"]', senha: '123456', role: 'funcionario' },
        { id: 9, nome: 'Weslley Ferreira de Siqueira', email: 'weslley-f@zaminebrasil.com', nivel: 'Pleno', pontos: 360, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 10, nome: 'Jadson Joao Romano', email: 'jadson-r@zaminebrasil.com', nivel: 'Senior', pontos: 440, conquistas: '["star", "fire", "gold"]', senha: 'admin123', role: 'gestor' },
        { id: 11, nome: 'Charles de Andrade', email: 'charles-a@zaminebrasil.com', nivel: 'Pleno', pontos: 390, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 12, nome: 'Jose Carlos Rodrigues de Santana', email: 'jose-s@zaminebrasil.com', nivel: 'Junior', pontos: 220, conquistas: '["star"]', senha: '123456', role: 'funcionario' },
        { id: 13, nome: 'Max Henrique Araujo', email: 'max-r@zaminebrasil.com', nivel: 'Pleno', pontos: 340, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 14, nome: 'Emerson Luiz Alexandre', email: 'emerson-a@zaminebrasil.com', nivel: 'Senior', pontos: 460, conquistas: '["star", "fire", "gold"]', senha: 'admin123', role: 'gestor' },
        { id: 99, nome: 'Gestor do Sistema', email: 'wallysson-s@zaminebrasil.com', nivel: 'Administrador', pontos: 999, conquistas: '["star", "fire", "gold", "crown"]', senha: 'admin123', role: 'gestor' },
        { id: 100, nome: 'Wallysson Diego Santiago Santos', email: 'wallysson-s@zaminebrasil.com', nivel: 'Coordenador', pontos: 999, conquistas: '["star", "fire", "gold", "crown"]', senha: 'admin123', role: 'gestor' },
        { id: 101, nome: 'Julio Cesar Sanches', email: 'julio-s@zaminebrasil.com', nivel: 'Gerente', pontos: 999, conquistas: '["star", "fire", "gold", "crown"]', senha: 'admin123', role: 'gestor' },
        { id: 15, nome: 'Warlen Eduardo Pereira Silva', email: 'warlen-s@zaminebrasil.com', nivel: 'Pleno', pontos: 350, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 16, nome: 'Cicero de Sousa Costa', email: 'cicero-c@zaminebrasil.com', nivel: 'Senior', pontos: 420, conquistas: '["star", "fire", "gold"]', senha: '123456', role: 'funcionario' },
    ];

    let inseridos = 0;
    usuariosPadrao.forEach((usuario) => {
        db.run(`
        INSERT OR IGNORE INTO usuarios
        (id, nome, email, senha, nivel, pontos, conquistas, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            usuario.id,
            usuario.nome,
            usuario.email,
            usuario.senha,
            usuario.nivel,
            usuario.pontos,
            usuario.conquistas,
            usuario.role
        ], function(err) {
            if (err) console.error(`Erro ao inserir usuário ${usuario.nome}:`, err);
            else {
                inseridos++;
                if (inseridos === usuariosPadrao.length) {
                    console.log('✅ Todos os usuários padrão foram inseridos');
                    // Iniciar backups automáticos
                    agendarBackups();
                }
            }
        });
    });
}

// Função para normalizar dados da demanda
function normalizarDadosDemanda(demanda) {
    if (!demanda) return demanda;

    // Garante que 'diasSemana' seja um array
    if (typeof demanda.diasSemana === 'string') {
        try {
            demanda.diasSemana = JSON.parse(demanda.diasSemana);
        } catch (e) {
            demanda.diasSemana = [];
        }
    } else if (!Array.isArray(demanda.diasSemana)) {
        demanda.diasSemana = [];
    }

    // Garante que 'atribuidos' seja um array
    if (typeof demanda.atribuidos === 'string') {
        try {
            demanda.atribuidos = JSON.parse(demanda.atribuidos);
        } catch (e) {
            demanda.atribuidos = [];
        }
    } else if (!Array.isArray(demanda.atribuidos)) {
        demanda.atribuidos = [];
    }

    // Garante que 'isRotina' seja um booleano
    demanda.isRotina = Boolean(demanda.isRotina);

    // Garante que 'anexosCriacao' seja um array
    if (typeof demanda.anexosCriacao === 'string') {
        try {
            demanda.anexosCriacao = JSON.parse(demanda.anexosCriacao);
        } catch (e) {
            demanda.anexosCriacao = [];
        }
    } else if (!Array.isArray(demanda.anexosCriacao)) {
        demanda.anexosCriacao = [];
    }

    // Garante que 'anexosResolucao' seja um array
    if (typeof demanda.anexosResolucao === 'string') {
        try {
            demanda.anexosResolucao = JSON.parse(demanda.anexosResolucao);
        } catch (e) {
            demanda.anexosResolucao = [];
        }
    } else if (!Array.isArray(demanda.anexosResolucao)) {
        demanda.anexosResolucao = [];
    }

    // Garante que 'comentariosUsuarios' seja um array
    if (typeof demanda.comentariosUsuarios === 'string') {
        try {
            demanda.comentariosUsuarios = JSON.parse(demanda.comentariosUsuarios);
        } catch (e) {
            demanda.comentariosUsuarios = [];
        }
    } else if (!Array.isArray(demanda.comentariosUsuarios)) {
        demanda.comentariosUsuarios = [];
    }

    return demanda;
}

// Função para registrar auditoria
const registrarAuditoria = (acao, tabela, registroId, dadosAntigos, dadosNovos, usuarioId, ip) => {
    const sql = `
    INSERT INTO auditoria (acao, tabela, registroId, dadosAntigos, dadosNovos, usuarioId, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
        acao,
        tabela,
        registroId,
        JSON.stringify(dadosAntigos || {}),
        JSON.stringify(dadosNovos || {}),
        usuarioId,
        ip
    ], (err) => {
        if (err) console.error('Erro ao registrar auditoria:', err);
    });
};

// Middleware de validação simples
const validarDemanda = (req, res, next) => {
    const { nomeDemanda, categoria, prioridade, complexidade, descricao, local, dataLimite } = req.body;

    if (!nomeDemanda || nomeDemanda.trim().length < 3) {
        return res.status(400).json({ success: false, error: 'Nome da demanda é obrigatório' });
    }

    if (!categoria) {
        return res.status(400).json({ success: false, error: 'Categoria é obrigatória' });
    }

    if (!dataLimite) {
        return res.status(400).json({ success: false, error: 'Data limite é obrigatória' });
    }

    next();
};

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check melhorado
app.get('/health', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM demandas', [], (err, row) => {
        if (err) {
            console.error('Erro no health check:', err);
            return res.status(500).json({
                status: 'ERROR',
                error: err.message,
                timestamp: new Date().toISOString()
            });
        }

        res.json({
            status: 'OK',
            demandas: row.count,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            memory: process.memoryUsage()
        });
    });
});

// GET /api/demandas - Listar demandas
app.get('/api/demandas', (req, res) => {
    const { status, funcionarioId, categoria, prioridade, month, year } = req.query;

    let sql = 'SELECT * FROM demandas WHERE 1=1';
    const params = [];

    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }

    if (funcionarioId) {
        sql += ' AND funcionarioId = ?';
        params.push(funcionarioId);
    }

    if (categoria) {
        sql += ' AND categoria = ?';
        params.push(categoria);
    }

    if (prioridade) {
        sql += ' AND prioridade = ?';
        params.push(prioridade);
    }

    // Filtros de mês e ano
    if (month || year) {
        if (month && year) {
            sql += ' AND strftime("%m", dataCriacao) = ? AND strftime("%Y", dataCriacao) = ?';
            params.push(month.padStart(2, '0'), year);
        } else if (month) {
            sql += ' AND strftime("%m", dataCriacao) = ?';
            params.push(month.padStart(2, '0'));
        } else if (year) {
            sql += ' AND strftime("%Y", dataCriacao) = ?';
            params.push(year);
        }
    }

    sql += ' ORDER BY dataCriacao DESC';

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Erro ao buscar demandas:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        // Normalizar cada demanda antes de enviar
        const demandasNormalizadas = rows.map(demanda => normalizarDadosDemanda(demanda));
        res.json(demandasNormalizadas);
    });
});

// GET /api/usuarios
app.get('/api/usuarios', (req, res) => {
    db.all('SELECT * FROM usuarios', [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json(rows);
    });
});

// POST /api/demandas - Criar nova demanda
app.post('/api/demandas', validarDemanda, (req, res) => {
    const d = req.body;

    // Normalizar dados antes de salvar
    const dadosNormalizados = normalizarDadosDemanda(d);

    // Gerar TAG única se não fornecida
    if (!dadosNormalizados.tag) {
        dadosNormalizados.tag = `DEM-${Date.now()}`;
    }

    const sql = `
    INSERT INTO demandas
    (funcionarioId, nomeFuncionario, emailFuncionario, categoria, prioridade, complexidade, descricao, local, dataCriacao, dataLimite, status, isRotina, diasSemana, tag, comentarios, comentarioGestor, atribuidos, anexosCriacao, nomeDemanda, criadoPor, comentariosUsuarios)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
        dadosNormalizados.funcionarioId,
        dadosNormalizados.nomeFuncionario,
        dadosNormalizados.emailFuncionario,
        dadosNormalizados.categoria,
        dadosNormalizados.prioridade,
        dadosNormalizados.complexidade,
        dadosNormalizados.descricao,
        dadosNormalizados.local,
        dadosNormalizados.dataCriacao || new Date().toISOString(),
        dadosNormalizados.dataLimite,
        dadosNormalizados.status || 'pendente',
        dadosNormalizados.isRotina ? 1 : 0,
        JSON.stringify(dadosNormalizados.diasSemana),
        dadosNormalizados.tag,
        dadosNormalizados.comentarios || '',
        dadosNormalizados.comentarioGestor || '',
        JSON.stringify(dadosNormalizados.atribuidos),
        JSON.stringify(dadosNormalizados.anexosCriacao),
        dadosNormalizados.nomeDemanda,
        dadosNormalizados.funcionarioId,
        JSON.stringify(dadosNormalizados.comentariosUsuarios || [])
    ];

    db.run(sql, params, function(err) {
        if (err) {
            console.error('Erro ao criar demanda:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        // Registrar auditoria
        registrarAuditoria(
            'CREATE',
            'demandas',
            this.lastID,
            null,
            dadosNormalizados,
            dadosNormalizados.funcionarioId,
            req.ip
        );

        res.json({
            success: true,
            demanda: { id: this.lastID, ...dadosNormalizados, dataCriacao: params[8] }
        });
    });
});

// PUT /api/demandas/:id - Atualizar demanda
app.put('/api/demandas/:id', (req, res) => {
    const id = req.params.id;
    const d = req.body;

    // Buscar demanda existente
    db.get('SELECT * FROM demandas WHERE id = ?', [id], (err, demandaExistente) => {
        if (err) {
            console.error('Erro ao buscar demanda:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        if (!demandaExistente) {
            return res.status(404).json({ success: false, error: 'Demanda não encontrada' });
        }

        // Normalizar dados antes de atualizar
        const dadosNormalizados = normalizarDadosDemanda(d);

        const dadosCompletos = { ...demandaExistente, ...dadosNormalizados };

        // Atualizar data de modificação
        dadosCompletos.dataAtualizacao = new Date().toISOString();
        dadosCompletos.atualizadoPor = d.funcionarioId;

        const sql = `
        UPDATE demandas SET
        funcionarioId = ?, nomeFuncionario = ?, emailFuncionario = ?, categoria = ?, prioridade = ?,
        complexidade = ?, descricao = ?, local = ?, dataLimite = ?, status = ?,
        isRotina = ?, diasSemana = ?, tag = ?, comentarios = ?, comentarioGestor = ?,
        dataConclusao = ?, atribuidos = ?, anexosCriacao = ?, anexosResolucao = ?,
        comentarioReprovacaoAtribuicao = ?, nomeDemanda = ?, dataAtualizacao = ?, atualizadoPor = ?, comentariosUsuarios = ?
        WHERE id = ?
        `;

        const params = [
            dadosCompletos.funcionarioId,
            dadosCompletos.nomeFuncionario,
            dadosCompletos.emailFuncionario,
            dadosCompletos.categoria,
            dadosCompletos.prioridade,
            dadosCompletos.complexidade,
            dadosCompletos.descricao,
            dadosCompletos.local,
            dadosCompletos.dataLimite,
            dadosCompletos.status,
            dadosCompletos.isRotina ? 1 : 0,
            JSON.stringify(dadosCompletos.diasSemana),
            dadosCompletos.tag,
            dadosCompletos.comentarios || '',
            dadosCompletos.comentarioGestor || '',
            dadosCompletos.dataConclusao || null,
            JSON.stringify(dadosCompletos.atribuidos),
            JSON.stringify(dadosCompletos.anexosCriacao),
            JSON.stringify(dadosCompletos.anexosResolucao),
            dadosCompletos.comentarioReprovacaoAtribuicao || '',
            dadosCompletos.nomeDemanda,
            dadosCompletos.dataAtualizacao,
            dadosCompletos.atualizadoPor,
            JSON.stringify(dadosCompletos.comentariosUsuarios || []),
            id
        ];

        db.run(sql, params, function(err) {
            if (err) {
                console.error('Erro ao atualizar demanda:', err);
                return res.status(500).json({ success: false, error: err.message });
            }

            // Registrar auditoria
            registrarAuditoria(
                'UPDATE',
                'demandas',
                id,
                demandaExistente,
                dadosCompletos,
                d.funcionarioId,
                req.ip
            );

            // Criar backup para mudanças de status
            if (['aprovada', 'reprovada'].includes(d.status)) {
                criarBackup('status_change');
            }

            res.json({
                success: true,
                demanda: { id: parseInt(id), ...dadosCompletos }
            });
        });
    });
});

// DELETE /api/demandas/:id - Excluir demanda
app.delete('/api/demandas/:id', (req, res) => {
    const id = req.params.id;

    // Buscar demanda antes de excluir
    db.get('SELECT * FROM demandas WHERE id = ?', [id], (err, demanda) => {
        if (err) {
            console.error('Erro ao buscar demanda para exclusão:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        if (!demanda) {
            return res.status(404).json({ success: false, error: 'Demanda não encontrada' });
        }

        db.run('DELETE FROM demandas WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('Erro ao excluir demanda:', err);
                return res.status(500).json({ success: false, error: err.message });
            }

            // Registrar auditoria
            registrarAuditoria(
                'DELETE',
                'demandas',
                id,
                demanda,
                null,
                req.body.usuarioId || null,
                req.ip
            );

            // Criar backup antes de excluir
            criarBackup('delete');

            res.json({ success: true });
        });
    });
});

// POST /api/demandas/:id/extend-deadline - Estender prazo de demanda
app.post('/api/demandas/:id/extend-deadline', (req, res) => {
    const id = req.params.id;
    const { novaDataLimite, motivo } = req.body;

    if (!novaDataLimite || !motivo) {
        return res.status(400).json({
            success: false,
            error: 'Nova data limite e motivo são obrigatórios'
        });
    }

    // Buscar demanda existente
    db.get('SELECT * FROM demandas WHERE id = ?', [id], (err, demandaExistente) => {
        if (err) {
            console.error('Erro ao buscar demanda:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        if (!demandaExistente) {
            return res.status(404).json({ success: false, error: 'Demanda não encontrada' });
        }

        // Atualizar apenas os campos necessários
        const sql = `
        UPDATE demandas SET
        dataLimite = ?,
        comentarioGestor = ?,
        dataAtualizacao = ?
        WHERE id = ?
        `;

        const comentarioAtual = demandaExistente.comentarioGestor || '';
        const novoComentario = `${comentarioAtual}\n[Prazo estendido em ${new Date().toLocaleDateString('pt-BR')}: ${motivo}]`;

        db.run(sql, [novaDataLimite, novoComentario, new Date().toISOString(), id], function(err) {
            if (err) {
                console.error('Erro ao estender prazo da demanda:', err);
                return res.status(500).json({ success: false, error: err.message });
            }

            // Registrar auditoria
            registrarAuditoria(
                'EXTEND_DEADLINE',
                'demandas',
                id,
                { dataLimite: demandaExistente.dataLimite, comentarioGestor: demandaExistente.comentarioGestor },
                { dataLimite: novaDataLimite, comentarioGestor: novoComentario },
                req.body.usuarioId || null,
                req.ip
            );

            // Buscar demanda atualizada para retornar
            db.get('SELECT * FROM demandas WHERE id = ?', [id], (err, demandaAtualizada) => {
                if (err) {
                    console.error('Erro ao buscar demanda atualizada:', err);
                    return res.status(500).json({ success: false, error: err.message });
                }

                res.json({
                    success: true,
                    demanda: normalizarDadosDemanda(demandaAtualizada)
                });
            });
        });
    });
});

// POST /api/demandas/:id/reassign - Reatribuir demanda
app.post('/api/demandas/:id/reassign', (req, res) => {
    const id = req.params.id;
    const { novoAtribuidoId, motivo } = req.body;

    if (!novoAtribuidoId || !motivo) {
        return res.status(400).json({
            success: false,
            error: 'Novo atribuído e motivo são obrigatórios'
        });
    }

    // Buscar demanda existente
    db.get('SELECT * FROM demandas WHERE id = ?', [id], (err, demandaExistente) => {
        if (err) {
            console.error('Erro ao buscar demanda:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        if (!demandaExistente) {
            return res.status(404).json({ success: false, error: 'Demanda não encontrada' });
        }

        // Buscar dados do novo atribuído
        db.get('SELECT * FROM usuarios WHERE id = ?', [novoAtribuidoId], (err, novoUsuario) => {
            if (err) {
                console.error('Erro ao buscar novo usuário:', err);
                return res.status(500).json({ success: false, error: err.message });
            }

            if (!novoUsuario) {
                return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
            }

            // Adicionar novo atribuído à lista existente
            let atribuidosAtuais = [];
            try {
                atribuidosAtuais = JSON.parse(demandaExistente.atribuidos || '[]');
            } catch (e) {
                atribuidosAtuais = [];
            }

            // Verificar se já não está atribuído
            if (!atribuidosAtuais.find(a => a.id == novoAtribuidoId)) {
                atribuidosAtuais.push({
                    id: novoUsuario.id,
                    nome: novoUsuario.nome,
                    email: novoUsuario.email
                });
            }

            // Atualizar demanda
            const sql = `
            UPDATE demandas SET
            atribuidos = ?,
            status = ?,
            comentarioGestor = ?,
            dataAtualizacao = ?
            WHERE id = ?
            `;

            const comentarioAtual = demandaExistente.comentarioGestor || '';
            const novoComentario = `${comentarioAtual}\n[Reatribuído em ${new Date().toLocaleDateString('pt-BR')} para ${novoUsuario.nome}: ${motivo}]`;

            db.run(sql, [
                JSON.stringify(atribuidosAtuais),
                'atribuida_pendente_aceitacao',
                novoComentario,
                new Date().toISOString(),
                id
            ], function(err) {
                if (err) {
                    console.error('Erro ao reatribuir demanda:', err);
                    return res.status(500).json({ success: false, error: err.message });
                }

                // Registrar auditoria
                registrarAuditoria(
                    'REASSIGN',
                    'demandas',
                    id,
                    { atribuidos: demandaExistente.atribuidos, status: demandaExistente.status },
                    { atribuidos: atribuidosAtuais, status: 'atribuida_pendente_aceitacao' },
                    req.body.usuarioId || null,
                    req.ip
                );

                // Buscar demanda atualizada para retornar
                db.get('SELECT * FROM demandas WHERE id = ?', [id], (err, demandaAtualizada) => {
                    if (err) {
                        console.error('Erro ao buscar demanda atualizada:', err);
                        return res.status(500).json({ success: false, error: err.message });
                    }

                    res.json({
                        success: true,
                        demanda: normalizarDadosDemanda(demandaAtualizada)
                    });
                });
            });
        });
    });
});

// POST /api/demandas/batch - Importação em lote (NOVA E MELHORADA)
app.post('/api/demandas/batch', (req, res) => {
    const { demandas } = req.body;
    
    if (!Array.isArray(demandas)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Formato inválido. Envie um array de demandas.' 
        });
    }
    
    console.log(`Iniciando importação em lote de ${demandas.length} demandas...`);
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    const results = [];
    
    // Processar em lote com transação
    db.serialize(() => {
        db.run('BEGIN TRANSACTION', (err) => {
            if (err) {
                console.error('Erro ao iniciar transação:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Erro ao iniciar transação do banco de dados' 
                });
            }
            
            // Processar cada demanda
            demandas.forEach((demanda, index) => {
                try {
                    const dadosNormalizados = normalizarDadosDemanda(demanda);
                    
                    // Garantir ID único se não existir
                    if (!dadosNormalizados.id) {
                        dadosNormalizados.id = Date.now() + Math.random();
                    }
                    
                    // Garantir TAG única se não existir
                    if (!dadosNormalizados.tag) {
                        dadosNormalizados.tag = `DEM-IMP-${Date.now()}-${index}`;
                    }
                    
                    const sql = `
                    INSERT OR REPLACE INTO demandas
                    (id, funcionarioId, nomeFuncionario, emailFuncionario, categoria, prioridade, complexidade, 
                     descricao, local, dataCriacao, dataLimite, status, isRotina, diasSemana, tag, comentarios, 
                     comentarioGestor, dataConclusao, atribuidos, anexosCriacao, anexosResolucao, 
                     comentarioReprovacaoAtribuicao, nomeDemanda, comentariosUsuarios)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    
                    const params = [
                        dadosNormalizados.id,
                        dadosNormalizados.funcionarioId,
                        dadosNormalizados.nomeFuncionario,
                        dadosNormalizados.emailFuncionario,
                        dadosNormalizados.categoria,
                        dadosNormalizados.prioridade,
                        dadosNormalizados.complexidade,
                        dadosNormalizados.descricao,
                        dadosNormalizados.local,
                        dadosNormalizados.dataCriacao,
                        dadosNormalizados.dataLimite,
                        dadosNormalizados.status || 'pendente',
                        dadosNormalizados.isRotina ? 1 : 0,
                        JSON.stringify(dadosNormalizados.diasSemana),
                        dadosNormalizados.tag,
                        dadosNormalizados.comentarios || '',
                        dadosNormalizados.comentarioGestor || '',
                        dadosNormalizados.dataConclusao || null,
                        JSON.stringify(dadosNormalizados.atribuidos),
                        JSON.stringify(dadosNormalizados.anexosCriacao),
                        JSON.stringify(dadosNormalizados.anexosResolucao),
                        dadosNormalizados.comentarioReprovacaoAtribuicao || '',
                        dadosNormalizados.nomeDemanda,
                        JSON.stringify(dadosNormalizados.comentariosUsuarios || [])
                    ];
                    
                    db.run(sql, params, function(err) {
                        if (err) {
                            errorCount++;
                            const errorMsg = `Erro na demanda ${index + 1} (${dadosNormalizados.tag || 'sem tag'}): ${err.message}`;
                            errors.push(errorMsg);
                            console.error(errorMsg);
                        } else {
                            successCount++;
                            results.push({
                                id: dadosNormalizados.id,
                                tag: dadosNormalizados.tag,
                                nome: dadosNormalizados.nomeDemanda,
                                status: 'success'
                            });
                        }
                    });
                    
                } catch (error) {
                    errorCount++;
                    const errorMsg = `Erro ao processar demanda ${index + 1}: ${error.message}`;
                    errors.push(errorMsg);
                    console.error(errorMsg);
                }
            });
            
            // Comitar transação após processar todas
            setTimeout(() => {
                db.run('COMMIT', (err) => {
                    if (err) {
                        console.error('Erro no commit da transação:', err);
                        return res.status(500).json({ 
                            success: false, 
                            error: 'Erro na transação do banco de dados' 
                        });
                    }
                    
                    console.log(`Importação concluída: ${successCount} sucesso(s), ${errorCount} erro(s)`);
                    
                    // Criar backup após importação bem-sucedida
                    if (successCount > 0) {
                        criarBackup('batch_import', (err, filename) => {
                            if (err) {
                                console.error('Erro ao criar backup pós-importação:', err);
                            } else {
                                console.log(`Backup pós-importação criado: ${filename}`);
                            }
                        });
                    }
                    
                    res.json({
                        success: true,
                        message: `Importação concluída: ${successCount} sucesso(s), ${errorCount} erro(s)`,
                        successCount,
                        errorCount,
                        errors: errors.slice(0, 20), // Retorna apenas os primeiros 20 erros
                        results: results.slice(0, 50) // Retorna apenas os primeiros 50 resultados
                    });
                });
            }, 1000); // Esperar 1 segundo para processar todas as inserções
        });
    });
});

// POST /api/feedbacks
app.post('/api/feedbacks', (req, res) => {
    const { funcionarioId, tipo, mensagem } = req.body;
    const gestorId = 99; // ID do gestor padrão

    const sql = `
    INSERT INTO feedbacks (funcionarioId, gestorId, tipo, mensagem, dataCriacao)
    VALUES (?, ?, ?, ?, ?)
    `;

    db.run(sql, [funcionarioId, gestorId, tipo, mensagem, new Date().toISOString()], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, feedback: { id: this.lastID, funcionarioId, gestorId, tipo, mensagem } });
    });
});

// GET /api/feedbacks
app.get('/api/feedbacks', (req, res) => {
    db.all('SELECT * FROM feedbacks ORDER BY dataCriacao DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json(rows);
    });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
    const { email, senha } = req.body;

    db.get('SELECT * FROM usuarios WHERE email = ? AND senha = ?', [email, senha], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!row) return res.status(401).json({ success: false, error: 'Credenciais inválidas' });

        // Remover senha do retorno
        const { senha: _, ...usuarioSemSenha } = row;
        res.json({ success: true, usuario: usuarioSemSenha });
    });
});

// POST /api/auth/reset-password
app.post('/api/auth/reset-password', (req, res) => {
    const { email } = req.body;
    res.json({ success: true, message: 'Instruções de redefinição de senha enviadas para o email' });
});

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
    const { nome, email, role } = req.body;
    res.json({ success: true, message: 'Solicitação de cadastro recebida' });
});

// GET /api/demandas/estatisticas
app.get('/api/demandas/estatisticas', (req, res) => {
    const { periodo = 30 } = req.query;

    const dataCorte = new Date();
    dataCorte.setDate(dataCorte.getDate() - parseInt(periodo));

    const sql = `
    SELECT
    COUNT(*) as total,
    COUNT(CASE WHEN status = 'aprovada' THEN 1 END) as aprovadas,
    COUNT(CASE WHEN status = 'pendente' THEN 1 END) as pendentes,
    COUNT(CASE WHEN status = 'reprovada' THEN 1 END) as reprovadas,
    COUNT(CASE WHEN status = 'finalizado_pendente_aprovacao' THEN 1 END) em_analise,
    COUNT(CASE WHEN isRotina = 1 THEN 1 END) as rotina
    FROM demandas
    WHERE dataCriacao >= ?
    `;

    db.get(sql, [dataCorte.toISOString()], (err, row) => {
        if (err) {
            console.error('Erro ao buscar estatísticas:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        res.json({ success: true, estatisticas: row });
    });
});

// GET /api/demandas/search
app.get('/api/demandas/search', (req, res) => {
    const { q, limit = 20 } = req.query;

    if (!q || q.length < 2) {
        return res.json({ success: true, data: [] });
    }

    const sql = `
    SELECT * FROM demandas
    WHERE nomeDemanda LIKE ? OR descricao LIKE ? OR tag LIKE ?
    ORDER BY dataCriacao DESC
    LIMIT ?
    `;

    const searchTerm = `%${q}%`;

    db.all(sql, [searchTerm, searchTerm, searchTerm, parseInt(limit)], (err, rows) => {
        if (err) {
            console.error('Erro na busca:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        const demandasNormalizadas = rows.map(demanda => normalizarDadosDemanda(demanda));
        res.json({ success: true, data: demandasNormalizadas });
    });
});

// GET /api/anotacoes - Listar anotações
app.get('/api/anotacoes', (req, res) => {
    const { criadoPor, atribuidoA, month, year } = req.query;

    let sql = 'SELECT * FROM anotacoes WHERE 1=1';
    const params = [];

    if (criadoPor) {
        sql += ' AND criadoPor = ?';
        params.push(criadoPor);
    }

    if (atribuidoA) {
        sql += ' AND atribuidoA = ?';
        params.push(atribuidoA);
    }

    // Filtros de mês e ano
    if (month || year) {
        if (month && year) {
            sql += ' AND strftime("%m", dataCriacao) = ? AND strftime("%Y", dataCriacao) = ?';
            params.push(month.padStart(2, '0'), year);
        } else if (month) {
            sql += ' AND strftime("%m", dataCriacao) = ?';
            params.push(month.padStart(2, '0'));
        } else if (year) {
            sql += ' AND strftime("%Y", dataCriacao) = ?';
            params.push(year);
        }
    }

    sql += ' ORDER BY dataCriacao DESC';

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Erro ao buscar anotações:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        res.json(rows);
    });
});

// POST /api/anotacoes - Criar nova anotação
app.post('/api/anotacoes', (req, res) => {
    const { titulo, conteudo, cor, criadoPor, atribuidoA, audioData } = req.body;

    if (!titulo || !conteudo || !criadoPor) {
        return res.status(400).json({
            success: false,
            error: 'Título, conteúdo e criadoPor são obrigatórios'
        });
    }

    const sql = `
    INSERT INTO anotacoes (titulo, conteudo, cor, criadoPor, atribuidoA, audioData)
    VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [titulo, conteudo, cor || '#3498db', criadoPor, atribuidoA || null, audioData || null], function(err) {
        if (err) {
            console.error('Erro ao criar anotação:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        // Buscar anotação criada para retornar
        db.get('SELECT * FROM anotacoes WHERE id = ?', [this.lastID], (err, row) => {
            if (err) {
                console.error('Erro ao buscar anotação criada:', err);
                return res.status(500).json({ success: false, error: err.message });
            }

            res.json({
                success: true,
                anotacao: row
            });
        });
    });
});

// PUT /api/anotacoes/:id - Atualizar anotação
app.put('/api/anotacoes/:id', (req, res) => {
    const id = req.params.id;
    const { titulo, conteudo, cor, atribuidoA, audioData } = req.body;

    // Buscar anotação existente
    db.get('SELECT * FROM anotacoes WHERE id = ?', [id], (err, anotacaoExistente) => {
        if (err) {
            console.error('Erro ao buscar anotação:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        if (!anotacaoExistente) {
            return res.status(404).json({ success: false, error: 'Anotação não encontrada' });
        }

        const sql = `
        UPDATE anotacoes SET
        titulo = ?,
        conteudo = ?,
        cor = ?,
        atribuidoA = ?,
        audioData = ?,
        atualizadoEm = ?
        WHERE id = ?
        `;

        db.run(sql, [
            titulo || anotacaoExistente.titulo,
            conteudo || anotacaoExistente.conteudo,
            cor || anotacaoExistente.cor,
            atribuidoA !== undefined ? atribuidoA : anotacaoExistente.atribuidoA,
            audioData !== undefined ? audioData : anotacaoExistente.audioData,
            new Date().toISOString(),
            id
        ], function(err) {
            if (err) {
                console.error('Erro ao atualizar anotação:', err);
                return res.status(500).json({ success: false, error: err.message });
            }

            // Buscar anotação atualizada para retornar
            db.get('SELECT * FROM anotacoes WHERE id = ?', [id], (err, anotacaoAtualizada) => {
                if (err) {
                    console.error('Erro ao buscar anotação atualizada:', err);
                    return res.status(500).json({ success: false, error: err.message });
                }

                res.json({
                    success: true,
                    anotacao: anotacaoAtualizada
                });
            });
        });
    });
});

// DELETE /api/anotacoes/:id - Excluir anotação
app.delete('/api/anotacoes/:id', (req, res) => {
    const id = req.params.id;

    db.run('DELETE FROM anotacoes WHERE id = ?', [id], function(err) {
        if (err) {
            console.error('Erro ao excluir anotação:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        res.json({ success: true });
    });
});

// POST /api/backup
app.post('/api/backup', (req, res) => {
    const { tipo = 'manual' } = req.body;

    criarBackup(tipo, (err, filename) => {
        if (err) {
            console.error('Erro ao criar backup:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        res.json({
            success: true,
            message: `Backup criado com sucesso`,
            filename: filename
        });
    });
});

// GET /api/backup - Download do backup atual
app.get('/api/backup', (req, res) => {
    db.all('SELECT * FROM demandas', [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });

        const backup = {
            data: new Date().toISOString(),
            demandas: rows.map(demanda => normalizarDadosDemanda(demanda))
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="backup_${Date.now()}.json"`);
        res.send(JSON.stringify(backup, null, 2));
    });
});

// POST /api/restore
app.post('/api/restore', (req, res) => {
    const { demandas } = req.body;

    if (!Array.isArray(demandas)) {
        return res.status(400).json({ success: false, error: 'Formato inválido' });
    }

    let successCount = 0;
    let errorCount = 0;

    demandas.forEach(demanda => {
        const dadosNormalizados = normalizarDadosDemanda(demanda);

        const sql = `
        INSERT OR REPLACE INTO demandas
        (id, funcionarioId, nomeFuncionario, emailFuncionario, categoria, prioridade, complexidade, descricao, local, dataCriacao, dataLimite, status, isRotina, diasSemana, tag, comentarios, comentarioGestor, dataConclusao, atribuidos, anexosCriacao, anexosResolucao, comentarioReprovacaoAtribuicao, nomeDemanda, comentariosUsuarios)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            dadosNormalizados.id,
            dadosNormalizados.funcionarioId,
            dadosNormalizados.nomeFuncionario,
            dadosNormalizados.emailFuncionario,
            dadosNormalizados.categoria,
            dadosNormalizados.prioridade,
            dadosNormalizados.complexidade,
            dadosNormalizados.descricao,
            dadosNormalizados.local,
            dadosNormalizados.dataCriacao,
            dadosNormalizados.dataLimite,
            dadosNormalizados.status,
            dadosNormalizados.isRotina ? 1 : 0,
            JSON.stringify(dadosNormalizados.diasSemana),
            dadosNormalizados.tag,
            dadosNormalizados.comentarios || '',
            dadosNormalizados.comentarioGestor || '',
            dadosNormalizados.dataConclusao || null,
            JSON.stringify(dadosNormalizados.atribuidos),
            JSON.stringify(dadosNormalizados.anexosCriacao),
            JSON.stringify(dadosNormalizados.anexosResolucao),
            dadosNormalizados.comentarioReprovacaoAtribuicao || '',
            dadosNormalizados.nomeDemanda,
            JSON.stringify(dadosNormalizados.comentariosUsuarios || [])
        ];

        db.run(sql, params, function(err) {
            if (err) {
                errorCount++;
                console.error('Erro ao restaurar demanda:', err);
            } else {
                successCount++;
            }
        });
    });

    setTimeout(() => {
        res.json({
            success: true,
            message: `Restauração concluída. ${successCount} demandas restauradas, ${errorCount} erros.`
        });
    }, 1000);
});

// Função para criar backups
const criarBackup = (tipo = 'auto', callback) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${tipo}_${timestamp}.json`;
    const backupPath = path.join(backupDir, filename);

    // Buscar todas as demandas
    db.all('SELECT * FROM demandas', [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar demandas para backup:', err);
            if (callback) callback(err);
            return;
        }

        const backupData = {
            versao: '1.0.0',
            data: timestamp,
            tipo: tipo,
            totalDemandas: rows.length,
            demandas: rows.map(demanda => normalizarDadosDemanda(demanda))
        };

        fs.writeFile(backupPath, JSON.stringify(backupData, null, 2), (err) => {
            if (err) {
                console.error('Erro ao salvar backup:', err);
                if (callback) callback(err);
                return;
            }

            console.log(`✅ Backup ${tipo} criado: ${filename}`);
            if (callback) callback(null, filename);
        });
    });
};

// Agendar backups automáticos
function agendarBackups() {
    // Backup automático a cada 6 horas
    setInterval(() => {
        criarBackup('auto');
    }, 6 * 60 * 60 * 1000);

    // Limpar backups antigos (manter apenas 10)
    setInterval(() => {
        fs.readdir(backupDir, (err, files) => {
            if (err) return;

            const backupFiles = files.filter(f => f.startsWith('backup_auto_'));
            if (backupFiles.length > 10) {
                // Ordenar por data (mais antigos primeiro)
                backupFiles.sort();

                // Remover os mais antigos
                const toRemove = backupFiles.slice(0, backupFiles.length - 10);
                toRemove.forEach(file => {
                    fs.unlink(path.join(backupDir, file), (err) => {
                        if (err) console.error('Erro ao remover backup antigo:', err);
                    });
                });
            }
        });
    }, 24 * 60 * 60 * 1000);
}

// Tratamento de erros global
app.use((err, req, res, next) => {
    console.error('❌ Erro não tratado:', err);
    res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: process.env.NODE_ENV === 'production' ? 'Erro interno' : err.message,
        timestamp: new Date().toISOString()
    });
});

// Rota 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Rota não encontrada',
        path: req.path,
        method: req.method
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado em porta ${PORT}`);
    console.log(`📁 Diretório de backups: ${backupDir}`);
    console.log(`⏰ Backups automáticos a cada 6 horas`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📦 Nova rota de importação em lote: POST /api/demandas/batch`);
});

// Tratamento de encerramento gracioso
process.on('SIGINT', () => {
    console.log('\n🛑 Recebido SIGINT. Criando backup final...');

    criarBackup('shutdown', (err, filename) => {
        if (err) {
            console.error('Erro ao criar backup final:', err);
        } else {
            console.log(`✅ Backup final criado: ${filename}`);
        }

        console.log('👋 Encerrando servidor...');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Recebido SIGTERM. Encerrando servidor...');
    process.exit(0);
});
