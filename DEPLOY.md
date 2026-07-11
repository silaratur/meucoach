# Publicação — Hostinger VPS (feita em 06/07/2026)

**URL do app: https://meucoach.silaratur.cloud**

## Como está montado

O VPS (72.60.7.224) já usava **Traefik** (proxy com HTTPS automático) roteando domínios
para containers Docker. O Meu Coach entrou nesse esquema **sem alterar** os apps existentes:

- Código do app: `/opt/meu-coach` (dist + server + node_modules + .env + data/)
- Container: `meu-coach-meucoach-1` (imagem **`node:22-bookworm-slim`** — glibc, não alpine! — roda `node server/index.mjs` na porta 8787)
- Compose próprio: `/opt/meu-coach/docker-compose.yml`, conectado à rede `root_default` do Traefik
- Rota/SSL: labels Traefik com `Host(meucoach.silaratur.cloud)` + certresolver `mytlschallenge` (Let's Encrypt)
- Chave da IA: `/opt/meu-coach/.env` (copiada do `/root/.env` que já existia no servidor)
- DNS: registro A `meucoach` → 72.60.7.224 (criado no hPanel)

## Banco de dados (desde 06/07/2026)

O app usa **SQLite** (`better-sqlite3`) em `/opt/meu-coach/data/meucoach.db` — perfis, dados (refeições,
treinos, evolução) e mídias (fotos/vídeos/áudios como BLOB) de todas as pessoas. Login é por **nome + PIN**
(sem e-mail), com token JWT guardado no navegador de cada aparelho; o segredo de assinatura fica em
`data/jwt-secret` (gerado automaticamente no primeiro start).

Como `/opt/meu-coach` inteiro é bind-mount do container, a pasta `data/` **persiste** normalmente entre
deploys (o `tar -xzf` só sobrescreve os arquivos do pacote) e entre reinícios do container/VPS.

⚠️ **Importante — motivo de trocar para `node:22-bookworm-slim`:** o `npm install` roda no HOST (Ubuntu,
glibc), então o binário nativo do `better-sqlite3` é compilado para glibc. A imagem `node:22-alpine` usa
musl e dava `ERR_DLOPEN_FAILED`. Se um dia trocar a imagem de volta para alpine, seria preciso rodar o
`npm install` DENTRO de um container alpine (ou usar `--build-from-source`).

### Backup do banco (recomendado periodicamente)

```bash
ssh -i ~/.ssh/meucoach_deploy root@72.60.7.224 "cp /opt/meu-coach/data/meucoach.db /opt/meu-coach/data/backup-\$(date +%Y%m%d).db"
```

## Acesso SSH

Chave dedicada sem senha no PC: `~/.ssh/meucoach_deploy` (pública instalada em `/root/.ssh/authorized_keys`).

```powershell
ssh -o IdentitiesOnly=yes -i $env:USERPROFILE\.ssh\meucoach_deploy root@72.60.7.224
```

## Deploy automático (desde 11/07/2026)

Todo push na branch `main` do repositório [github.com/silaratur/meucoach](https://github.com/silaratur/meucoach)
dispara `.github/workflows/deploy.yml`: builda, empacota, faz backup do banco, envia por SSH,
reinstala dependências no VPS e reinicia o container — o mesmo roteiro manual abaixo, automatizado.

- Usa uma chave SSH **dedicada só para o CI** (`meucoach_ci`, diferente da `meucoach_deploy` usada
  manualmente) — pública adicionada em `/root/.ssh/authorized_keys` do VPS, privada guardada como
  secret `VPS_SSH_KEY` no GitHub (`VPS_HOST`/`VPS_USER` também são secrets). Se precisar revogar o
  acesso do GitHub Actions, remova só essa chave do `authorized_keys` — não afeta o acesso manual.
- Rodar manualmente: aba **Actions** do repositório → workflow "Deploy para produção" → **Run workflow**.
- O deploy manual abaixo continua funcionando normalmente (útil se não quiser passar pelo GitHub).

## Atualizar o app manualmente (depois de mudanças no código)

Na pasta do projeto, no PC:

```powershell
npm run build
tar -czf $env:TEMP\meu-coach.tar.gz dist server package.json package-lock.json
scp -o IdentitiesOnly=yes -i $env:USERPROFILE\.ssh\meucoach_deploy $env:TEMP\meu-coach.tar.gz root@72.60.7.224:/tmp/
ssh -o IdentitiesOnly=yes -i $env:USERPROFILE\.ssh\meucoach_deploy root@72.60.7.224 "tar -xzf /tmp/meu-coach.tar.gz -C /opt/meu-coach && cd /opt/meu-coach && npm install --omit=dev && docker compose restart"
```

> No Git Bash / WSL, use `/tmp/meu-coach.tar.gz` em vez de `$TEMP` — `tar` interpreta `C:\...` como
> `host:caminho` (sintaxe remota) e falha com "Cannot connect to C: resolve failed".

## Comandos úteis (no VPS)

```bash
docker logs meu-coach-meucoach-1 --tail 50   # ver logs do app
cd /opt/meu-coach && docker compose restart   # reiniciar
docker compose down                           # parar (não afeta os outros apps)
```
