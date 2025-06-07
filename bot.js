/* bot.js – Trading bot 24/7 avec stratégies pluggables, IA, journalisation CSV et limite journalière de perte */
require('dotenv').config();
const LIVE_MODE = process.env.LIVE_MODE === 'true';
const ccxt  = require('ccxt');
const fs    = require('fs');
const axios = require('axios');
const cron  = require('node-cron');
const technical = require('technicalindicators');
const pLimit = require('p-limit');

const { predictAI } = require('./ai/client');
const { calculateStopLossPrice, calculatePositionSize } = require('./risk/positionSizer');
const { smartMarketOrder } = require('./execution/smartRouter');
const { sendAlert } = require('./notifier/email');
const { generateReport } = require('./reportGenerator');
require('./strategies/registry');
require('./strategies/rsiMacd');
require('./strategies/maCrossover');
require('./strategies/breakout');
require('./strategies/scalpingRsi');
const { run: runStrategy } = require('./strategies/registry');

function stddev(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length);
}

function countGreenRed(closes) {
  let green = 0, red = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) green++;
    else if (closes[i] < closes[i - 1]) red++;
  }
  return { green, red };
}

function getTrailingStop(entryPrice, highestPrice, trailingPercent) {
  // trailingPercent = 0.01 pour 1%
  return highestPrice * (1 - trailingPercent);
}

/* bot.js – Trading bot 24/7 avec stratégies pluggables, IA, journalisation CSV et limite journalière de perte */
require('dotenv').config();
const LIVE_MODE = process.env.LIVE_MODE === 'true';
const ccxt  = require('ccxt');
const fs    = require('fs');
const axios = require('axios');
const cron  = require('node-cron');
const technical = require('technicalindicators');
const pLimit = require('p-limit');

const { predictAI } = require('./ai/client');
const { calculateStopLossPrice, calculatePositionSize } = require('./risk/positionSizer');
const { smartMarketOrder } = require('./execution/smartRouter');
const { sendAlert } = require('./notifier/email');
const { generateReport } = require('./reportGenerator');
require('./strategies/registry');
require('./strategies/rsiMacd');
require('./strategies/maCrossover');
require('./strategies/breakout');
require('./strategies/scalpingRsi');
const { run: runStrategy } = require('./strategies/registry');

function stddev(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length);
}

function countGreenRed(closes) {
  let green = 0, red = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) green++;
    else if (closes[i] < closes[i - 1]) red++;
  }
  return { green, red };
}

function getTrailingStop(entryPrice, highestPrice, trailingPercent) {
  // trailingPercent = 0.01 pour 1%
  return highestPrice * (1 - trailingPercent);
}


async function sellWatcher(exchange) {
  console.log('🔔 SellWatcher démarré');
  while (true) {
    try {
      const balance = await exchange.fetchBalance();
      const symbols = Object.keys(exchange.markets).filter(s => s.endsWith("/USD") || s.endsWith("/CAD"));

      for (const symbol of symbols) {
        const market = exchange.market(symbol);
        const base = market.base;
        const heldAmount = balance.total[base];

        if (!heldAmount || heldAmount < 0.0001) continue;

        const ticker = await exchange.fetchTicker(symbol);
        const priceNow = ticker.last;

        // Initialiser position si non enregistrée
        if (!openPositions[symbol]) {
          openPositions[symbol] = {
            entryPrice: priceNow,
            size: heldAmount,
            highest: priceNow
          };
          console.log(`📌 Nouvelle position détectée : ${symbol} - ${heldAmount} ${base}`);
        } else {
          openPositions[symbol].highest = Math.max(openPositions[symbol].highest, priceNow);
        }

        const position = openPositions[symbol];
        const stopLoss     = position.entryPrice * 0.97;  // –3%
        const takeProfit   = position.entryPrice * 1.06;  // +6%
        const trailingStop = position.highest    * 0.99;  // –1% du plus haut

        console.log(`${symbol} → priceNow=${priceNow.toFixed(5)}, stopLoss=${stopLoss.toFixed(5)}, takeProfit=${takeProfit.toFixed(5)}, trailingStop=${trailingStop.toFixed(5)}`);

        // IA de sortie (facultative)
        let shouldExitByAI = false;
        try {
          const ohlcv = await exchange.fetchOHLCV(symbol, '5m', undefined, 30);
          const ohlc = ohlcv.map(candle => candle[4]);
const features = {
  price: priceNow,
  amount: heldAmount,
  rsi: technical.RSI.calculate({ values: ohlc, period: 14 }).slice(-1)[0] || 50,
  atr: technical.ATR.calculate({ high: ohlcv.map(c=>c[2]), low: ohlcv.map(c=>c[3]), close: ohlc, period: 14 }).slice(-1)[0] || 0,
  macd: technical.MACD.calculate({ values: ohlc, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }).slice(-1)[0]?.MACD || 0,
  variation_pct: ((priceNow - ohlc[0]) / ohlc[0]) || 0,
  volume: ohlcv.map(c=>c[5]).reduce((a,b)=>a+b, 0)/ohlcv.length || 0,
  trendH1: -1,
  trendH4: -1
};
const res = await axios.post(`${IA_URL}/predict-success`, features);
shouldExitByAI = res.data.prediction === 0;
console.log(`   🧠 IA exit signal = ${shouldExitByAI}`);
        } catch (e) {
          console.log('   ⚠️ Erreur IA sortie :', e.message);
        }

        if (
          priceNow <= stopLoss ||
          priceNow >= takeProfit ||
          priceNow <= trailingStop ||
          shouldExitByAI
        ) {
          console.log(`🚨 [SELL] Conditions remplies pour ${symbol}`);
          await smartMarketOrder(market, 'sell', position.size, priceNow);
          console.log(`✅ Vente passée pour ${symbol} à ${priceNow}`);
          delete openPositions[symbol];
        }
      }
    } catch (err) {
      console.error('❌ Erreur dans sellWatcher :', err.message);
    }

    await sleep(10 * 1000);
  }
}



// === CONFIGURATION ===
const selectedStrategy = 'scalpingRsi';
const strategyParams   = require('./best-params.json');
const IA_URL           = process.env.IA_URL || 'http://127.0.0.1:5000';
const LOOKBACK         = 500;
const RISK_PERCENT     = 0.02;
const STOPLOSS_PCT     = 0.03;
const GLOBAL_EXPOSURE_LIMIT = 0.75;
const DAILY_LOSS_LIMIT = 0.02;
const TIMEFRAME        = '5m';
const INTERVAL_MS      = 60 * 1000;
const SLEEP_BETWEEN    = 200;
const VOLUME_THRESHOLD = 100;
const MAX_POSITIONS_PER_SYMBOL = 1;
let openPositions = {};
let dailyLoss = 0;
let currentDay = new Date().toISOString().slice(0, 10);
let lossStreak = 0;
let baseRiskPercent = RISK_PERCENT; // garde la valeur de base

// === IA classifieur : prédit si le trade sera gagnant (1) ou non (0)
async function predictTradeSuccess(price, amount, closes, highs, lows, volumes, trendH1 = 0, trendH4 = 0) {
  try {
    const recentCloses = closes.slice(-30);
    const recentHighs  = highs.slice(-30);
    const recentLows   = lows.slice(-30);
    const recentVolumes = volumes.slice(-10);

    if (recentCloses.length < 26 || recentHighs.length < 14 || recentLows.length < 14) {
      console.warn("Pas assez de données pour calculer les indicateurs, trade ignoré.");
      return true;  // on renvoie true pour ne pas bloquer la boucle
    }

    const rsiArr  = technical.RSI.calculate({ values: recentCloses, period: 14 });
    const atrArr  = technical.ATR.calculate({ high: recentHighs, low: recentLows, close: recentCloses, period: 14 });
    const macdArr = technical.MACD.calculate({
      values: recentCloses,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    if (!rsiArr.length || !atrArr.length || !macdArr.at(-1)) {
      console.warn("Indicateurs non calculables, trade ignoré.");
      return true;
    }

    const volatility = stddev(recentCloses.slice(-14));
    const spread = recentHighs.at(-1) - recentLows.at(-1);
    const momentum = recentCloses.at(-1) - recentCloses.at(-7);
    const { green, red } = countGreenRed(recentCloses.slice(-10));
    const volumeChange = (recentVolumes.at(-1) - recentVolumes[0]) / (recentVolumes[0] || 1);

    const features = {
      price: recentCloses.at(-1),
      amount: 1,
      rsi: rsiArr.at(-1),
      atr: atrArr.at(-1),
      macd: macdArr.at(-1).MACD,
      variation_pct: ((recentCloses.at(-1) - recentCloses.at(-6)) / recentCloses.at(-6)) * 100,
      volume: recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length,
      trendH1,
      trendH4,
      volatility,
      spread,
      momentum,
      green_bars: green,
      red_bars: red,
      volume_change: volumeChange
    };

    console.log("Features envoyées à l'IA :", features);

    const res = await axios.post(`${IA_URL}/predict-success`, features);
    return res.data.prediction === 1;
  } catch (e) {
    if (e.response) {
      console.warn("⚠️ Erreur IA classifieur :", e.response.data);
    } else {
      console.warn("⚠️ Erreur IA classifieur :", e.message);
    }
    return true;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadSymbols() {
  const ex = new ccxt.kraken({
    enableRateLimit: true,
    apiKey: process.env.KRAKEN_API_KEY,
    secret: process.env.KRAKEN_SECRET,
  });
  await ex.loadMarkets();
  // On ne garde que les paires actives avec une limite "amount.min" définie ET dont la devise de cotation est CAD ou USD
  return Object.values(ex.markets)
    .filter(m => m.active && m.limits?.amount?.min && (m.quote === 'CAD' || m.quote === 'USD'))
    .map(m => m.symbol);
}


cron.schedule('0 0 * * *', async () => {
  try {
    const { trainClassifierFromCSV } = require('./ai/trainScheduler');
    trainClassifierFromCSV('trades.csv');
    const res = await axios.post(`${IA_URL}/train`, { closes: [] });
    console.log('🔄 IA ré-entraînée :', res.data);
  } catch (e) {
    console.warn('⚠️ Échec du ré-entraînement IA :', e.message);
  }
});

cron.schedule('1 0 * * *', () => {
  generateReport();
});

console.log('🤖 Cron de ré-entraînement IA programmé chaque jour à minuit.');


(async () => {
  // 1) Affichage des soldes au démarrage
  const exchange = new ccxt.kraken({
    enableRateLimit: true,
    apiKey: process.env.KRAKEN_API_KEY,
    secret: process.env.KRAKEN_SECRET,
  });
  const balances = await exchange.fetchBalance();
  sellWatcher(exchange); // Démarre la surveillance des ventes en parallèle
  console.log("💰 Soldes disponibles :", {
    USD: balances.total.USD,
    CAD: balances.total.CAD,
    ...Object.fromEntries(
      Object.entries(balances.total)
        .filter(([asset, amt]) => amt > 0 && asset !== 'USD' && asset !== 'CAD')
    )
  });

  // 2) Chargement des symboles à scanner
  const symbols = await loadSymbols();
  console.log(`🔍 Scanning ${symbols.length} paires USD & CAD :`, symbols.join(', '));

  // 3) Boucle principale asynchrone
  while (true) {
    const start = Date.now();
    const exchangeLoop = new ccxt.kraken({
      enableRateLimit: true,
      apiKey: process.env.KRAKEN_API_KEY,
      secret: process.env.KRAKEN_SECRET,
    });
    const limit = pLimit(3); // 3 analyses en parallèle, ajuste selon la limite d’API de Kraken

    await Promise.all(symbols.map(symbol =>
      limit(async () => {
        try {
          // Récupération des données OHLCV
          const ohlcv = await exchangeLoop.fetchOHLCV(symbol, TIMEFRAME, undefined, LOOKBACK);
          const closes = ohlcv.map(c => c[4]);
          // Ignore les marchés où les 5 dernières clôtures sont à zéro
          const closesAreZero = closes.slice(-5).every(c => c === 0);
          if (closesAreZero) {
            console.log(`   ⚠️ Marché ${symbol} inactif (clôtures à zéro); ignoré.`);
            return;
          }

          // === 5A. Auto-pause en cas de volatilité extrême ===
          const recentCloses = closes.slice(-5);
          const minClose = Math.min(...recentCloses);
          const maxClose = Math.max(...recentCloses);
          if (minClose > 0 && (maxClose - minClose) / minClose > 0.10) {
            console.log(`🚨 Volatilité extrême détectée sur ${symbol}, bot en pause 5 minutes pour cette paire.`);
            await sleep(5 * 60 * 1000);
            return;
          }

          // === 5B. Détection de régime de marché ===
          const closes20 = closes.slice(-20);
          const range = Math.max(...closes20) - Math.min(...closes20);
          const mean = closes20.reduce((a, b) => a + b, 0) / closes20.length;
          const regime = (range / mean > 0.03) ? 'trend' : 'range'; // seuil à ajuster
          console.log(`   📈 Régime détecté sur ${symbol} : ${regime}`);

          // Vérification que la paire dispose d'une clôture valide
          const entryPrice = closes.at(-1);
          if (!entryPrice || entryPrice <= 0) {
            console.log(`   ⚠️ Clôture invalide pour ${symbol} (${entryPrice}); paire ignorée.`);
            return;
          }

          // Ignorer les paires à faible liquidité
          const volumesAll = ohlcv.map(c => c[5]);
          const avgVol = volumesAll.reduce((sum, v) => sum + v, 0) / volumesAll.length;
          if (avgVol < VOLUME_THRESHOLD) {
            console.log(`   ⚠️ Volume moyen (${avgVol.toFixed(2)}) < seuil (${VOLUME_THRESHOLD}); paire ignorée.`);
            return;
          }

          // Calcul des tendances H1 / H4
          let trendH1 = 0, trendH4 = 0;
          try {
            const ohlcvH1 = await exchangeLoop.fetchOHLCV(symbol, '1h', undefined, 50);
            const ohlcvH4 = await exchangeLoop.fetchOHLCV(symbol, '4h', undefined, 50);
            const closeH1 = ohlcvH1.map(c => c[4]);
            const closeH4 = ohlcvH4.map(c => c[4]);

            trendH1 = closeH1.at(-1) > closeH1[0] ? 1 : -1;
            trendH4 = closeH4.at(-1) > closeH4[0] ? 1 : -1;
            console.log(`   🔍 Tendance H1: ${trendH1 === 1 ? 'Haussière' : 'Baissière'}, H4: ${trendH4 === 1 ? 'Haussière' : 'Baissière'}`);
          } catch (e) {
            console.warn('  ⚠️ Impossible de calculer la tendance H1/H4:', e.message);
          }

          console.log(`   ✅ OHLCV (${ohlcv.length} bougies)`);
          console.log('   Dernières clôtures :', closes.slice(-5).map(v => v.toFixed(2)).join(', '));

          const techSignal = runStrategy(selectedStrategy, closes, strategyParams);
          console.log('  ▶️ Signal stratégie :', techSignal);

          // Prédiction IA globale (non classifieur)
          let iaSignal = 'HOLD';
          try {
            const recentCloses = closes.slice(-30);
            const recentHighs = ohlcv.map(c => c[2]).slice(-30);
            const recentLows = ohlcv.map(c => c[3]).slice(-30);
            const recentVolumes = ohlcv.map(c => c[5]).slice(-10);

            if (recentCloses.length < 26 || recentHighs.length < 14 || recentLows.length < 14) {
              console.warn("Pas assez de données pour calculer les indicateurs, trade ignoré.");
              return;
            }

            const rsiArr = technical.RSI.calculate({ values: recentCloses, period: 14 });
            const atrArr = technical.ATR.calculate({ high: recentHighs, low: recentLows, close: recentCloses, period: 14 });
            const macdArr = technical.MACD.calculate({
              values: recentCloses,
              fastPeriod: 12,
              slowPeriod: 26,
              signalPeriod: 9,
              SimpleMAOscillator: false,
              SimpleMASignal: false
            });

            if (rsiArr.length === 0 || atrArr.length === 0 || !macdArr.at(-1)) {
              console.warn("Indicateurs non calculables, trade ignoré.");
              return;
            }

            const rsi  = rsiArr.at(-1);
            const atr  = atrArr.at(-1);
            const macd = macdArr.at(-1).MACD;
            const variation_pct = (recentCloses.length >= 6) ? ((recentCloses.at(-1) - recentCloses.at(-6)) / recentCloses.at(-6)) * 100 : 0;
            const avg_volume = recentVolumes.length > 0 ? recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length : 0;

            const features = {
              price: recentCloses.at(-1),
              amount: 1,
              rsi,
              atr,
              macd,
              variation_pct,
              volume: avg_volume,
              trendH1,
              trendH4
            };

            console.log("Features envoyées à l'IA :", features);
            const res = await predictAI(features);
            iaSignal = res.prediction;
            console.log(`   🧠 IA prédit : ${iaSignal}`);
          } catch (e) {
            // Le log détaillé est déjà géré dans predictAI
          }

          let finalSignal;
          if (
            (techSignal.type === 'BUY' && iaSignal === 2) ||
            (techSignal.type === 'SELL' && iaSignal === 0)
          ) {
            finalSignal = { type: techSignal.type, reason: 'Confluence Tech+IA' };
          } else {
            finalSignal = { type: 'HOLD', reason: 'Pas de confluence Tech+IA' };
          }
// --- mapping du code IA en action textuelle
let iaAction;
if      (iaSignal === 0) iaAction = 'SELL';
else if (iaSignal === 3) iaAction = 'BUY';
else                      iaAction = 'HOLD';

// --- confluence Tech vs IA
finalSignal;
if (techSignal.type === iaAction && techSignal.type !== 'HOLD') {
  finalSignal = {
    type: techSignal.type,
    reason: `Tech+IA=${techSignal.type}`
  };
} else {
  finalSignal = {
    type: 'HOLD',
    reason: `Pas de confluence (Tech=${techSignal.type}, IA=${iaAction})`
  };
}
          console.log('   🎯 Signal final :', finalSignal);

          // Gestion de la perte journalière
          const today = new Date().toISOString().slice(0, 10);
          if (today !== currentDay) {
            currentDay = today;
            dailyLoss = 0;
          }
          if (dailyLoss >= DAILY_LOSS_LIMIT) {
            console.log(`🚨 Perte journalière limite atteinte (${(dailyLoss * 100).toFixed(2)}%). Aucun trade aujourd’hui.`);
            return;
          }

          if (finalSignal.type !== 'HOLD') {
            try {
              const priceNow = closes.at(-1);
              const entryPrice = priceNow;
              const recentCloses = closes.slice(-14);
              const recentHighs = ohlcv.map(c => c[2]).slice(-14);
              const recentLows = ohlcv.map(c => c[3]).slice(-14);
              const recentVolumes = ohlcv.map(c => c[5]).slice(-10);

              let rsiArr = [];
              let atrArr = [];
              if (recentCloses.length >= 14 && recentHighs.length >= 14 && recentLows.length >= 14) {
                rsiArr = technical.RSI.calculate({ values: recentCloses, period: 14 });
                atrArr = technical.ATR.calculate({ high: recentHighs, low: recentLows, close: recentCloses, period: 14 });
              }
              const macdArr = technical.MACD.calculate({
                values: recentCloses,
                fastPeriod: 12,
                slowPeriod: 26,
                signalPeriod: 9,
                SimpleMAOscillator: false,
                SimpleMASignal: false
              });

              const rsi = rsiArr.length > 0 ? rsiArr.at(-1) : 50;
              const atr = atrArr.length > 0 ? atrArr.at(-1) : 0.01;
              const macd = macdArr.at(-1)?.MACD ?? 0;
              const variation_pct = (recentCloses.length >= 6) ? ((entryPrice - recentCloses.at(-6)) / recentCloses.at(-6)) * 100 : 0;
              const avg_volume = (recentVolumes.length > 0) ? (recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length) : 0;

              const features = {
                price: entryPrice,
                amount: 1,
                rsi,
                atr,
                macd,
                variation_pct,
                volume: avg_volume,
                trendH1,
                trendH4
              };

              let isTradeLikelyToWin = true;
              try {
                console.log("Données envoyées à l'IA (features):", features);
                const response = await axios.post(`${IA_URL}/predict-success`, features);
                isTradeLikelyToWin = response.data.prediction === 1;
              } catch (e) {
                console.error("---- ERREUR IA ----");
                console.error("Features envoyées:", features);
                if (e.response) {
                  console.error("Réponse complète IA:", JSON.stringify(e.response.data));
                } else {
                  console.error("Erreur IA classifieur:", e.message);
                }
                return;
              }

              if (!isTradeLikelyToWin) {
                console.log("   ❌ IA classifieur : ce trade est jugé perdant → TRADE ANNULÉ");
                return;
              }

              console.log("   ✅ IA classifieur : trade validé avec features →", features);

              const highPrices = ohlcv.map(c => c[2]);
              const lowPrices  = ohlcv.map(c => c[3]);
              const atrDynamic = technical.ATR.calculate({
                high: highPrices,
                low: lowPrices,
                close: closes,
                period: 14,
              });

              const latestATR = atrDynamic.at(-1);

              // Take profit dynamique basé sur la volatilité
              const takeProfitTarget = entryPrice + latestATR * 2.0;

              // Trailing stop dynamique
              let highestSinceEntry = Math.max(...closes.slice(closes.length - 10));
              const trailingStop = getTrailingStop(entryPrice, highestSinceEntry, 0.01);

              const stopLossLimit = Math.max(
                entryPrice - latestATR * 1.0, // stop classique
                trailingStop                // trailing stop
              );

              let exitSignal = null;
              try {
                const recentCloses = closes.slice(-14);
                const recentHighs = ohlcv.map(c => c[2]).slice(-14);
                const recentLows = ohlcv.map(c => c[3]).slice(-14);
                const recentVolumes = ohlcv.map(c => c[5]).slice(-10);

                let rsiArr = [];
                let atrArr = [];
                if (recentCloses.length >= 14 && recentHighs.length >= 14 && recentLows.length >= 14) {
                  rsiArr = technical.RSI.calculate({ values: recentCloses, period: 14 });
                  atrArr = technical.ATR.calculate({ high: recentHighs, low: recentLows, close: recentCloses, period: 14 });
                }
                const macdArr = technical.MACD.calculate({
                  values: recentCloses,
                  fastPeriod: 12,
                  slowPeriod: 26,
                  signalPeriod: 9,
                  SimpleMAOscillator: false,
                  SimpleMASignal: false
                });

                const rsi = rsiArr.length > 0 ? rsiArr.at(-1) : 50;
                const atr = atrArr.length > 0 ? atrArr.at(-1) : 0.01;
                const macd = macdArr.at(-1)?.MACD ?? 0;
                const variation_pct = (recentCloses.length >= 6) ? ((recentCloses.at(-1) - recentCloses.at(-6)) / recentCloses.at(-6)) * 100 : 0;
                const avg_volume = recentVolumes.length > 0 ? (recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length) : 0;

                const features = {
                  price: recentCloses.at(-1) ?? 0,
                  amount: 1,
                  rsi,
                  atr,
                  macd,
                  variation_pct,
                  volume: avg_volume,
                  trendH1,
                  trendH4
                };

                const res = await predictAI(features);
                const iaNext = res.prediction;
                if (iaNext === 'SELL') {
                  exitSignal = 'SELL';
                  console.log('   🧠 IA prédit une baisse → sortie anticipée déclenchée');
                }
              } catch (e) {
                console.warn('   ⚠️ Erreur IA (sortie dynamique) :', e.message);
              }

              if (
                priceNow >= takeProfitTarget ||
                priceNow <= stopLossLimit ||
                priceNow <= trailingStop ||
                exitSignal === 'SELL'
              ) {
                console.log('   🔔 Sortie anticipée déclenchée :', {
                  currentPrice: priceNow,
                  TP: takeProfitTarget.toFixed(2),
                  SL: stopLossLimit.toFixed(2),
                  trailingStop: trailingStop.toFixed(2),
                  reason: priceNow >= takeProfitTarget ? 'Take Profit atteint' :
                          priceNow <= stopLossLimit ? 'Stop Loss atteint' :
                          priceNow <= trailingStop ? 'Trailing Stop atteint' :
                          'Signal IA = SELL'
                });
                delete openPositions[symbol]; // Correction: suppression correcte de la position
                return;
              }

              const stopLossPrice = calculateStopLossPrice(entryPrice, STOPLOSS_PCT);
              const balances = await exchange.fetchBalance();
              const quote = symbol.split('/')[1];
              let accountBalance = balances.total[quote] || 0;

              // Si le solde est insuffisant dans la devise de cotation, tente de convertir l'autre devise
              if (accountBalance === 0) {
                if (quote === 'USD' && balances.total.CAD > 0) {
                  // Conversion CAD -> USD
                  const ticker = await exchange.fetchTicker('USD/CAD');
                  accountBalance = balances.total.CAD / ticker.last;
                } else if (quote === 'CAD' && balances.total.USD > 0) {
                  // Conversion USD -> CAD
                  const ticker = await exchange.fetchTicker('USD/CAD');
                  accountBalance = balances.total.USD * ticker.last;
                }
              }

              // Réduction du risque en cas de série de pertes
              let adjustedRisk = baseRiskPercent;
              if (lossStreak >= 2) adjustedRisk = baseRiskPercent / 2;
              if (lossStreak >= 4) adjustedRisk = baseRiskPercent / 4;

              const positionSize = calculatePositionSize(accountBalance, adjustedRisk, entryPrice, stopLossPrice);

              console.log("💰 Balances disponibles :", {
                USD: balances.total.USD,
                CAD: balances.total.CAD,
                [quote]: balances.total[quote]
              });

              console.log(`   📐 Sizing -> entry=${entryPrice.toFixed(2)}, size=${positionSize.toFixed(8)}, stop=${stopLossPrice.toFixed(2)}`);

              const market = exchange.markets[symbol];
              const minAmount = market.limits.amount.min * 0.6;

              let totalExposure = 0;
              for (const sym of symbols) {
                const q = sym.split('/')[1];
                const bal = balances.total[q] || 0;
                const px = closes.at(-1);
                totalExposure += bal * px;
              }

              const accountTotal = (balances.total.USD || 0) + (balances.total.CAD || 0);
              const maxAllowed = accountTotal * GLOBAL_EXPOSURE_LIMIT;

              if ((totalExposure + (positionSize * entryPrice)) > maxAllowed) {
                console.log(`   ❌ Exposition totale (${(totalExposure + (positionSize * entryPrice)).toFixed(2)} USD) > limite autorisée (${maxAllowed.toFixed(2)} USD). Trade ignoré.`);
                return;
              }

              if (openPositions[symbol] && openPositions[symbol] >= MAX_POSITIONS_PER_SYMBOL) {
                console.log(`   ⚠️ Déjà ${MAX_POSITIONS_PER_SYMBOL} position(s) ouverte(s) sur ${symbol}, on ignore ce signal.`);
                return;
              }

              if (positionSize < minAmount) {
                console.log(`   ⚠️ Taille (${positionSize.toFixed(8)}) < min (${minAmount}). Trade ignoré.`);
              } else {
                await sendAlert(
                  `Signal ${finalSignal.type} ${symbol}`,
                  `Signal: ${finalSignal.type} (${finalSignal.reason})\n` +
                  `Prix: ${entryPrice.toFixed(2)} ${quote}\n` +
                  `Taille: ${positionSize.toFixed(8)}\n` +
                  `Stop-Loss: ${stopLossPrice.toFixed(2)}\n` +
                  `Timestamp: ${new Date().toISOString()}`
                ).then(() => {
                  console.log('   ✅ Alerte email envoyée');
                }).catch((e) => {
                  console.warn(`   ⚠️ Alerte échouée : ${e.message}`);
                });
              }

              let orders = [];
              if (LIVE_MODE) {
                orders = await smartMarketOrder(symbol, positionSize, finalSignal.type.toLowerCase(), 4);
                console.log('   ✅ Orders exécutés :', orders);
              } else {
                console.log(`   🧪 LIVE_MODE désactivé → ordre ${finalSignal.type} NON exécuté`);
              }

              const lines = orders.map(o => JSON.stringify({
                id: o.id,
                symbol: o.symbol,
                side: o.side,
                price: o.average ?? o.price,
                amount: o.filled ?? o.amount,
                cost: o.cost,
                fee: o.fee?.cost,
                datetime: o.datetime,
              }));
              fs.appendFileSync('trades.log', lines.join('\n') + '\n');

              const csvLine = orders.map(o => [
                new Date().toISOString(),
                o.symbol,
                o.side,
                o.price,
                o.amount,
                finalSignal.reason,
                iaSignal,
                techSignal.type
              ].join(',')).join('\n');
              fs.appendFileSync('trades.csv', csvLine + '\n');
              console.log('   📊 trades.csv mis à jour');

              openPositions[symbol] = {
                entryPrice: entryPrice,
                size: positionSize,
                highest: entryPrice
              };

              // === Calcul du PnL et gestion de la série de pertes ===
              const pnl = orders.reduce((sum, o) => sum + (o.side === 'buy' ? -o.cost : o.cost), 0);
              dailyLoss += Math.max(0, -pnl / accountBalance);

              if (pnl < 0) {
                lossStreak++;
              } else {
                lossStreak = 0;
              }

              await sleep(SLEEP_BETWEEN);
            } catch (e) {
              console.warn(`Erreur sur ${symbol} :`, e.message);
            }
          }
        } catch (e) {
          console.warn(`Erreur sur ${symbol} :`, e.message);
        }
      })
    ));

    const elapsed = Date.now() - start;
    const wait = Math.max(0, INTERVAL_MS - elapsed);
    console.log(`\n↺ Attente ${Math.round(wait / 1000)}s avant prochain scan`);
    await sleep(wait);
  } // fin du while(true)
})(); // fin de l'IIFE
