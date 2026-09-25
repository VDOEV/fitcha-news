# Fitcha News — новостной конвейер канала «Это Фича»

Собирает свежие новости из Telegram-каналов, Reddit и RSS, находит пересечения
(о чём пишут многие источники сразу), скорит популярность и шлёт дайджест в Telegram-бот.
Полностью облачно, бесплатно, без зависимостей (чистый Node.js).

## Как это работает (пайплайн)

```
[20 TG-каналов]  [9 Reddit-сабов]  [15 RSS-лент]
        └────────────┬──────────────┘
              сбор свежего (окно 48ч)
                     ↓
      кластеризация заголовков (Jaccard ≥ 0.3)
        «одна новость у многих источников»
                     ↓
      скоринг: пересечения × 60 + популярность (просмотры/апвоуты, до 50)
               + свежесть (до 20)
                     ↓
      дайджест: 🔥 главная + 📋 топ-7 + 📄 одиночные
                     ↓
        Telegram Bot API → личка владельца
        (+ MAX Bot API — зарезервировано, включается секретами)
```

## Расписание

- GitHub Actions: cron `0 0 * * 3,5,0` (Ср/Пт/Вс 03:00 МСК). Планировщик GitHub
  задерживает запуски на ~4–5 ч — факт-отправка получается 07:00–08:00 МСК,
  до утреннего контент-слота 9:30.
- Метка `last-digest.txt` (дата МСК) гарантирует одну отправку в день:
  повторные попытки дня пропускаются.
- Ручной запуск: вкладка Actions → news-digest → Run workflow
  (или `gh workflow run news.yml -R VDOEV/fitcha-news`).

## Источники (sources.json)

- **Telegram (превью t.me/s/)**: @seeallochnaya, @ai_newz, @MLunderhood, @addmeto,
  @opendatascience, @not_boring_ds, @neurohive, @habr_ai, @pro_ai_official,
  @denissexy, @gonzo_ML, @data_secrets, @abitconnected, @neuralshit, @botfatherdev,
  @habr_com, @tproger, @vcru, @proglib, @d_code — из превью берутся тексты и просмотры.
- **Reddit (JSON API, топ дня)**: r/LocalLLaMA, r/MachineLearning, r/ClaudeAI,
  r/OpenAI, r/AI_Agents, r/cursor, r/ChatGPTCoding, r/programming, r/webdev — апвоуты.
- **RSS (29 лент)**: Хабр, vc.ru, Tproger, Opennet, 3DNews, CNews, Lenta, HackerNews,
  Techmeme, ArsTechnica, MIT Tech Review, arXiv cs.AI, Simon Willison, Latent Space,
  Hugging Face, The Verge, TechCrunch, Ben's Bites, The Rundown AI, Import AI,
  Eugene Yan, Lilian Weng, Jay Alammar, Interconnects, One Useful Thing, OpenAI News,
  DeepMind Blog, Aider, Vercel.

## Не парсится (нет RSS/платный API)

- X/Twitter-аккаунты (исследователи и компании) — контент приходит через TG, HN, Reddit
- tldrai.com, deeplearning.ai/the-batch, anthropic.com/news, cursor.com/blog, vibecoding.ru/news — RSS нет
- paperswithcode, lmarena.ai, epoch.ai, artificialanalysis — базы/бенчмарки, не новостные ленты

## Секреты (Settings → Secrets → Actions)

| Секрет | Назначение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен бота, который присылает дайджест |
| `TELEGRAM_CHAT_ID` | чат-получатель |
| `MAX_BOT_TOKEN` | опционально: токен бота MAX (дублирует дайджест) |
| `MAX_CHAT_ID` | опционально: chat_id MAX (узнать: `node get-max-chat-id.mjs <TOKEN>`) |

## Локальный запуск (не обязательно)

```
node index.mjs            # дайджест в консоль + digest.md
```

## Настройки (sources.json)

- `hoursWindow` — окно свежести, часов (48)
- `topClusters` — сколько позиций в дайджесте (7)
- `minJaccard` — порог схожести заголовков (0.3; меньше — шире кластеры)

## Известные ограничения

- X/Twitter не парсится (платный API) — контент исследователей приходит
  через TG-каналы, HN и Reddit.
- GitHub-планировщик задерживает крон (см. выше) — компенсировано ранним кроном.
- Реакции/комментарии TG в превью не видны — популярность считается по просмотрам.
- ИИ-рерайта нет (сознательно: дайджест сырой, текст пишет автор).
