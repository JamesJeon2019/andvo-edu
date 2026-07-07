# Andvo Edu — AI Lektionsgenerator

AI-powered lesson generator for Swedish schools. Built with Node.js + Claude API.

## Snabbstart

### 1. Klona och installera
```bash
git clone https://github.com/YOUR_USERNAME/andvo-edu.git
cd andvo-edu
npm install
```

### 2. Skapa .env fil
```bash
cp .env.example .env
# Lägg till din ANTHROPIC_API_KEY i .env
```

### 3. Kör lokalt
```bash
npm run dev
# Öppna http://localhost:3000
```

## Deploy på Render

1. Pusha till GitHub
2. Gå till render.com → New Web Service
3. Koppla GitHub repo
4. Lägg till miljövariabel: `ANTHROPIC_API_KEY`
5. Deploy!

## API Endpoints

| Method | URL | Beskrivning |
|--------|-----|-------------|
| POST | /api/lesson/generate | Generera ny lektion |
| GET | /api/lesson/:id | Hämta lektion |
| PUT | /api/lesson/:id/block/:blockId | Uppdatera block |
| DELETE | /api/lesson/:id/block/:blockId | Ta bort block |
| PUT | /api/lesson/:id/block/:blockId/toggle | Dölj/visa block |
| PUT | /api/lesson/:id/block/:blockId/youtube | Spara YouTube-länk |
| POST | /api/lesson/:id/block/:blockId/rewrite | AI skriver om block |
| PUT | /api/lesson/:id/blocks/reorder | Ändra ordning |

## Tech Stack

- **Backend**: Node.js + Express
- **AI**: Claude API (Anthropic)
- **Frontend**: HTML/CSS/JS (ingen framework)
- **Hosting**: Render
- **Nästa steg**: PostgreSQL, Google Classroom
