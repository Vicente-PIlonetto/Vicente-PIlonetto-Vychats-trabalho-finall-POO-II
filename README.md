# VyChat

Aplicativo de chat auto-hospedado com servidores, mensagens diretas, anexos de arquivos e um launcher integrado para iniciar o backend.

## Visao Geral

O VyChat e um projeto full-stack com:
- Backend em FastAPI com WebSockets para atualizacoes em tempo real.
- Frontend estatico em HTML/CSS/JS.
- Armazenamento local (SQLite + JSON).
- Launcher interativo para iniciar e configurar o servidor.
- Suporte opcional ao Tailscale Funnel para acesso externo.

## Requisitos

- Python 3.10 ou superior
- Pip atualizado

## Instalacao Rapida

1. Instale as dependencias:

```bash
pip install -r requirements.txt
```

2. Inicie o launcher:

```bash
python launcher.py
```

3. Abra no navegador:

```
http://127.0.0.1:8000/login
```

## Como Usar o Launcher

O `launcher.py` oferece um menu interativo para:
- Definir host e porta do servidor.
- Abrir o navegador automaticamente.
- Definir diretorio de dados personalizado.
- Iniciar o Tailscale Funnel.

Atalhos:
- `Ctrl+R` recarrega o servidor.
- `Ctrl+C` encerra o servidor.

## Armazenamento de Dados

Por padrao, os dados ficam em:

```
backend/data/
```

Voce pode alterar o caminho com a variavel de ambiente:

Windows (PowerShell):
```bash
$env:CIPHERLINE_DATA_DIR="C:\caminho\para\dados"
```

Windows (CMD):
```bash
set CIPHERLINE_DATA_DIR=C:\caminho\para\dados
```

Linux/macOS:
```bash
export CIPHERLINE_DATA_DIR="/caminho/para/dados"
```

O launcher salva as configuracoes em `backend/data/launcher_config.json`.

## Estrutura do Projeto

- `backend/` aplicacao FastAPI, rotas, storage e modelos.
- `frontend/` interface web estatica.
- `launcher.py` menu interativo para subir o servidor.
- `requirements.txt` dependencias Python.
- `render.yaml` configuracao de deploy no Render.
- `vercel.json` configuracao de deploy no Vercel.

## Deploy

O projeto inclui arquivos prontos para:
- Render: `render.yaml`
- Vercel: `vercel.json`

Para deploy local ou em VPS, basta seguir a instalacao rapida e manter o processo rodando.

## Observacoes

- O launcher abre o navegador automaticamente (configuravel).
- Tailscale Funnel exige o CLI do Tailscale instalado e autenticado.
