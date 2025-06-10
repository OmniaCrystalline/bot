/** @format */

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const express = require("express");

const app = express();
app.use(express.json());

// Инициализация бота с webhook
const bot = new TelegramBot(process.env.BOT_TOKEN);
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://bot-2m94.onrender.com";

// Хранение списка доменов для каждого пользователя
const userDomains = new Map();

// Функция для проверки доступности домена
async function checkDomain(domain) {
  try {
    const response = await axios.get(`http://${domain}`, {
      timeout: 5000,
      validateStatus: function (status) {
        return status >= 200 && status < 600; // Принимаем любой статус как успешный ответ
      },
    });
    return true;
  } catch (error) {
    return false;
  }
}

// Функция для отправки результатов проверки
async function sendCheckResults(chatId) {
  if (!userDomains.has(chatId) || userDomains.get(chatId).size === 0) {
    return;
  }

  const domains = Array.from(userDomains.get(chatId));
  let results = "🕒 Автоматическая проверка доменов:\n\n";

  for (const domain of domains) {
    const isAvailable = await checkDomain(domain);
    results += `${domain}: ${isAvailable ? "✅" : "❌"}\n`;
  }

  bot.sendMessage(chatId, results);
}

// Функция для запуска автоматической проверки
function startAutoCheck(chatId) {
  // Проверка каждые 12 часов (12 * 60 * 60 * 1000 миллисекунд)
  setInterval(() => {
    sendCheckResults(chatId);
  }, 12 * 60 * 60 * 1000);
}

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "Привет! Я бот для проверки доменов.\n\n" +
      "Доступные команды:\n" +
      "/add domain.com - добавить домен в список\n" +
      "/remove domain.com - удалить домен из списка\n" +
      "/list - показать список доменов\n" +
      "/check - проверить все домены в списке\n" +
      "/autocheck - включить автоматическую проверку каждые 12 часов"
  );

  // Запускаем автоматическую проверку при старте
  startAutoCheck(chatId);
});

// Добавление домена
bot.onText(/\/add (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const domain = match[1].trim();

  if (!userDomains.has(chatId)) {
    userDomains.set(chatId, new Set());
  }

  userDomains.get(chatId).add(domain);
  bot.sendMessage(chatId, `Домен ${domain} добавлен в список!`);
});

// Удаление домена
bot.onText(/\/remove (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const domain = match[1].trim();

  if (userDomains.has(chatId) && userDomains.get(chatId).has(domain)) {
    userDomains.get(chatId).delete(domain);
    bot.sendMessage(chatId, `Домен ${domain} удален из списка!`);
  } else {
    bot.sendMessage(chatId, "Домен не найден в списке!");
  }
});

// Показать список доменов
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;

  if (!userDomains.has(chatId) || userDomains.get(chatId).size === 0) {
    bot.sendMessage(chatId, "Список доменов пуст!");
    return;
  }

  const domains = Array.from(userDomains.get(chatId)).join("\n");
  bot.sendMessage(chatId, `Ваш список доменов:\n${domains}`);
});

// Проверка всех доменов
bot.onText(/\/check/, async (msg) => {
  const chatId = msg.chat.id;

  if (!userDomains.has(chatId) || userDomains.get(chatId).size === 0) {
    bot.sendMessage(chatId, "Список доменов пуст!");
    return;
  }

  const domains = Array.from(userDomains.get(chatId));
  let results = "Результаты проверки:\n\n";

  for (const domain of domains) {
    const isAvailable = await checkDomain(domain);
    results += `${domain}: ${isAvailable ? "✅" : "❌"}\n`;
  }

  bot.sendMessage(chatId, results);
});

// Команда для включения автоматической проверки
bot.onText(/\/autocheck/, (msg) => {
  const chatId = msg.chat.id;
  startAutoCheck(chatId);
  bot.sendMessage(
    chatId,
    "Автоматическая проверка доменов включена! Проверка будет выполняться каждые 12 часов."
  );
});

// Настройка webhook
app.post(`/webhook`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  try {
    await bot.setWebHook(`${WEBHOOK_URL}/webhook`);
    console.log("Webhook установлен успешно");
  } catch (error) {
    console.error("Ошибка при установке webhook:", error);
  }
});
