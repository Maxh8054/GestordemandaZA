// server.js - Versão Completa e Corrigida
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sua-chave-secreta-aqui-mude-em-producao';

// Configuração CORS para Render e desenvolvimento
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://0.0.0.0:3000', 'https://gestordemandaza.onrender.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Rate limiting para proteção
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limite de 100 requisições por IP
    message: { error: 'Muitas requisições, tente novamente mais tarde' }
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

// Middleware de logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
    next();
});

// Criar servidor HTTP para WebSocket
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: ["http://localhost:3000", "http://127.0.0.1:3000", "https://gestordemandaza.onrender.com"],
        methods: ["GET", "POST"]
    }
});

// Configurar multer para upload de arquivos
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter: function(req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não permitido'));
        }
    }
});

// Criar diretório para backups
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

// Gerenciar conexões WebSocket
io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('Usuário desconectado:', socket.id);
    });
});

// Função para inicializar o banco de dados
function inicializarBancoDados() {
    // Tabela de usuários
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY,
            nome TEXT UNIQUE,
            email TEXT UNIQUE,
            senha TEXT,
            nivel TEXT,
            pontos INTEGER DEFAULT 0,
            conquistas TEXT DEFAULT '[]',
            role TEXT DEFAULT 'funcionario',
            ultimoLogin TEXT,
            ativo INTEGER DEFAULT 1
        )
    `, (err) => {
        if (err) console.error('Erro ao criar tabela usuarios:', err);
        else {
            console.log('✅ Tabela usuarios criada/verificada');
            criarTabelaDemandas();
        }
    });
}

// Tabela de demandas
function criarTabelaDemandas() {
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
            FOREIGN KEY (funcionarioId) REFERENCES usuarios(id)
        )
    `, (err) => {
        if (err) console.error('Erro ao criar tabela demandas:', err);
        else {
            console.log('✅ Tabela demandas criada/verificada');
            criarIndices();
        }
    });
}

// Criar índices para performance
function criarIndices() {
    const indices = [
        'CREATE INDEX IF NOT EXISTS idx_status ON demandas(status)',
        'CREATE INDEX IF NOT EXISTS idx_funcionarioId ON demandas(funcionarioId)',
        'CREATE INDEX IF NOT EXISTS idx_dataLimite ON demandas(dataLimite)',
        'CREATE INDEX IF NOT EXISTS idx_tag ON demandas(tag)'
    ];

    let completed = 0;
    indices.forEach(sql => {
        db.run(sql, (err) => {
            if (err) console.error('Erro ao criar índice:', err);
            else {
                completed++;
                if (completed === indices.length) {
                    console.log('✅ Índices criados/verificados');
                    inserirUsuariosPadrao();
                }
            }
        });
    });
}

// Inserir usuários padrão
async function inserirUsuariosPadrao() {
    const usuariosPadrao = [
        { id: 1, nome: 'Ranielly Miranda De Souza', email: 'ranielly-s@zaminebrasil.com', nivel: 'Senior', pontos: 450, conquistas: '["star", "fire", "gold"]', senha: '123456', role: 'funcionario' },
        { id: 2, nome: 'Girlene da Silva Nogueira', email: 'girlene-n@zaminebrasil.com', nivel: 'Pleno', pontos: 380, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 3, nome: 'Rafaela Cristine da Silva Martins', email: 'rafaela-m@zaminebrasil.com', nivel: 'Senior', pontos: 520, conquistas: '["star", "fire", "gold"]', senha: '123456', role: 'funcionario' },
        { id: 5, nome: 'Marcos Antônio Lino Rosa', email: 'marcos-a@zaminebrasil.com', nivel: 'Junior', pontos: 280, conquistas: '["star"]', senha: '123456', role: 'funcionario' },
        { id: 6, nome: 'Marcos Paulo Moraes Borges', email: 'marcos-b@zaminebrasil.com', nivel: 'Pleno', pontos: 410, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 7, nome: 'Marcelo Goncalves de Paula', email: 'marcelo-p@zaminebrasil.com', nivel: 'Senior', pontos: 480, conquistas: '["star", "fire", "gold"]', senha: '123456', role: 'funcionario' },
        { id: 8, nome: 'Higor Ataides Macedo', email: 'higor-a@zaminebrasil.com', nivel: 'Junior', pontos: 250, conquistas: '["star"]', senha: '123456', role: 'funcionario' },
        { id: 9, nome: 'Weslley Ferreira de Siqueira', email: 'weslley-f@zaminebrasil.com', nivel: 'Pleno', pontos: 360, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 10, nome: 'Jadson Joao Romano', email: 'jadson-r@zaminebrasil.com', nivel: 'Senior', pontos: 440, conquistas: '["star", "fire", "gold"]', senha: '123456', role: 'funcionario' },
        { id: 11, nome: 'Charles de Andrade', email: 'charles-a@zaminebrasil.com', nivel: 'Pleno', pontos: 390, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 12, nome: 'Jose Carlos Rodrigues de Santana', email: 'jose-s@zaminebrasil.com', nivel: 'Junior', pontos: 220, conquistas: '["star"]', senha: '123456', role: 'funcionario' },
        { id: 13, nome: 'Max Henrique Araujo', email: 'max-r@zaminebrasil.com', nivel: 'Pleno', pontos: 340, conquistas: '["star", "silver"]', senha: '123456', role: 'funcionario' },
        { id: 99, nome: 'Gestor do Sistema', email: 'wallysson-s@zaminebrasil.com', nivel: 'Administrador', pontos: 999, conquistas: '["star", "fire", "gold", "crown"]', senha: 'admin123', role: 'gestor' },
        { id: 100, nome: 'Wallysson Diego Santiago Santos', email: 'wallysson-s@zaminebrasil.com', nivel: 'Coordenador', pontos: 999, conquistas: '["star", "fire", "gold", "crown"]', senha: 'admin123', role: 'gestor' },
        { id: 101, nome: 'Julio Cesar Sanches', email: 'julio-s@zaminebrasil.com', nivel: 'Gerente', pontos: 999, conquistas: '["star", "fire", "gold", "crown"]', senha: 'admin123', role: 'gestor' }
    ];

    let inseridos = 0;
    for (const usuario of usuariosPadrao) {
        const senhaHash = await bcrypt.hash(usuario.senha, 10);
        
        db.run(`
            INSERT OR IGNORE INTO usuarios 
            (id, nome, email, senha, nivel, pontos, conquistas, role) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            usuario.id,
            usuario.nome,
            usuario.email,
            senhaHash,
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
                }
            }
        });
    }
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

    return demanda;
}

// Middleware de verificação de JWT (desabilitado temporariamente)
const verificarToken = (req, res, next) => {
    // Temporariamente desabilitado para testes
    // Descomente quando quiser ativar a autenticação
    /*
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, error: 'Token não fornecido' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Token inválido' });
    }
    */
    next();
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

// === ROTAS PRINCIPAIS ===

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
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
            memory: process.memoryUsage(),
            websocket: io.engine.clientsCount
        });
    });
});

// === ROTAS DE AUTENTICAÇÃO (SIMPLIFICADAS) ===

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    const { email, senha } = req.body;
    
    if (!email || !senha) {
        return res.status(400).json({ success: false, error: 'Email e senha são obrigatórios' });
    }
    
    db.get('SELECT * FROM usuarios WHERE email = ? AND ativo = 1', [email], async (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!row) return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
        
        try {
            const senhaValida = await bcrypt.compare(senha, row.senha);
            if (!senhaValida) {
                return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
            }
            
            // Atualizar último login
            db.run('UPDATE usuarios SET ultimoLogin = ? WHERE id = ?', [new Date().toISOString(), row.id]);
            
            // Remover senha do retorno
            const { senha: _, ...usuarioSemSenha } = row;
            
            // Gerar token JWT
            const token = jwt.sign(
                { id: row.id, email: row.email, role: row.role },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            res.json({ 
                success: true, 
                usuario: usuarioSemSenha,
                token: token
            });
        } catch (error) {
            console.error('Erro ao verificar senha:', error);
            res.status(500).json({ success: false, error: 'Erro interno do servidor' });
        }
    });
});

// GET /api/usuarios
app.get('/api/usuarios', (req, res) => {
    db.all('SELECT id, nome, email, nivel, pontos, conquistas, role, ultimoLogin FROM usuarios WHERE ativo = 1', [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json(rows);
    });
});

// === ROTAS DE DEMANDAS ===

// GET /api/demandas
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

// POST /api/demandas
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
        (funcionarioId, nomeFuncionario, emailFuncionario, categoria, prioridade, complexidade, descricao, local, dataCriacao, dataLimite, status, isRotina, diasSemana, tag, comentarios, comentarioGestor, atribuidos, anexosCriacao, nomeDemanda)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        dadosNormalizados.nomeDemanda
    ];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('Erro ao criar demanda:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
        
        res.json({ 
            success: true, 
            demanda: { id: this.lastID, ...dadosNormalizados, dataCriacao: params[8] }
        });
    });
});

// PUT /api/demandas/:id
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
        
        const sql = `
            UPDATE demandas SET
            funcionarioId = ?, nomeFuncionario = ?, emailFuncionario = ?, categoria = ?, prioridade = ?, 
            complexidade = ?, descricao = ?, local = ?, dataLimite = ?, status = ?, 
            isRotina = ?, diasSemana = ?, tag = ?, comentarios = ?, comentarioGestor = ?, 
            dataConclusao = ?, atribuidos = ?, anexosCriacao = ?, anexosResolucao = ?, 
            comentarioReprovacaoAtribuicao = ?, nomeDemanda = ?, dataAtualizacao = ?
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
            id
        ];
        
        db.run(sql, params, function(err) {
            if (err) {
                console.error('Erro ao atualizar demanda:', err);
                return res.status(500).json({ success: false, error: err.message });
            }
            
            res.json({ 
                success: true, 
                demanda: { id: parseInt(id), ...dadosCompletos }
            });
        });
    });
});

// DELETE /api/demandas/:id
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
            
            res.json({ success: true });
        });
    });
});

// === ROTAS DE UPLOAD ===

// POST /api/upload
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
    }
    
    res.json({
        success: true,
        file: {
            nome: req.file.originalname,
            tamanho: req.file.size,
            tipo: req.file.mimetype,
            caminho: req.file.filename
        }
    });
});

// GET /api/uploads/:filename
app.get('/api/uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads', filename);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
    }
});

// === ROTAS DE ESTATÍSTICAS ===

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

// === ROTAS DE BACKUP ===

// GET /api/backup
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
            (id, funcionarioId, nomeFuncionario, emailFuncionario, categoria, prioridade, complexidade, descricao, local, dataCriacao, dataLimite, status, isRotina, diasSemana, tag, comentarios, comentarioGestor, dataConclusao, atribuidos, anexosCriacao, anexosResolucao, comentarioReprovacaoAtribuicao, nomeDemanda)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            dadosNormalizados.nomeDemanda
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
server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado em porta ${PORT}`);
    console.log(`📁 Diretório de uploads: ${path.join(__dirname, 'uploads')}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📡 WebSocket habilitado para atualizações em tempo real`);
});

// Tratamento de encerramento gracioso
process.on('SIGINT', () => {
    console.log('\n🛑 Recebido SIGINT. Encerrando servidor...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Recebido SIGTERM. Encerrando servidor...');
    process.exit(0);
});
