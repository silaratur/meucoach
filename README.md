# 💪 Meu Coach — Personal e Nutricionista de bolso

Aplicativo (PWA) de cuidados com a saúde para a família: diário alimentar, treinos guiados por voz e avaliações feitas por IA (Claude).

## O que ele faz

- **Hoje (Diário)**: registre café da manhã, lanches, almoço, jantar, ceia e suplementos. Peça sugestões de refeição — a IA considera seu objetivo, preferências e **o que você tem na geladeira**.
- **Treino**: gere treinos com a IA (academia, casa ou rua), monte treinos manualmente, registre atividades livres (caminhada, corrida...).
- **Player de treino**: como um personal por áudio — anuncia o exercício, conta as séries, cronometra o descanso (configurável), dá incentivo por voz (pt-BR, offline) e **recomenda a carga com base no seu histórico** (progressão automática).
- **Coach**: avalia seu dia inteiro (alimentação + treino) como um personal + nutricionista, com 3 ações práticas para amanhã.
- **Perfil**: várias pessoas da família, cada uma com objetivo, restrições, preferências e histórico próprios.
- **Conta com nome + PIN**: os dados ficam salvos num banco de dados no servidor — a mesma conta funciona em qualquer navegador ou celular, sem perder nada ao trocar de aparelho.

## Como rodar

```bash
npm install
npm run dev:all
```

- No computador: abra http://localhost:5173
- No celular (mesma rede Wi-Fi): abra `http://IP-DO-PC:5173` (o IP aparece no terminal como "Network")

### Chave da IA

O servidor usa a variável de ambiente `ANTHROPIC_API_KEY` (do Windows ou de um arquivo `.env` — veja `.env.example`). Sem a chave, o app funciona normalmente, apenas os botões de IA mostram um aviso.

## Produção (uma porta só)

```bash
npm run build
npm start        # serve o app + API na porta 8787
```

## Instalar como app no Android

No Chrome do celular: menu ⋮ → **"Adicionar à tela inicial"**.

> Para instalar como PWA completo (funcionar offline/standalone), o acesso precisa ser por HTTPS — ou seja, publicando o app em um serviço como Render, Railway ou Fly.io (o servidor Node deste projeto já está pronto para isso: basta `npm run build` + `npm start` com a variável `ANTHROPIC_API_KEY` configurada).

## Estrutura

```
server/index.mjs   → API Express: auth (nome+PIN), CRUD de perfil/dados/mídia, proxy da IA (Claude)
server/db.mjs      → banco SQLite (better-sqlite3): perfis, dados e mídias
src/               → app React (abas Hoje, Treino, Coach, Perfil, Evolução)
src/components/WorkoutPlayer.tsx → o "personal por áudio"
src/components/LoginTab.tsx      → tela de login / criação de conta
public/            → manifest PWA, service worker, ícones
data/              → banco de dados local (SQLite) — criado automaticamente, nunca versionado
```

Os dados de cada pessoa (perfil, refeições, treinos, fotos, evolução) ficam salvos em um **banco de
dados no servidor** (`data/meucoach.db`), não no navegador — por isso acessar de qualquer aparelho com o
mesmo nome + PIN traz tudo de volta. Cada aparelho só lembra localmente *quem já entrou nele* (para pular
o login na próxima vez), nunca os dados em si.
