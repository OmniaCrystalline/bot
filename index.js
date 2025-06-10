/** @format */

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// Инициализация бота с polling
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Хранение списка доменов для каждого пользователя
const userDomains = new Map();

// Функция для валидации домена
function isValidDomain(domain) {
  // Проверяем, что домен соответствует формату
  const domainRegex =
    /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
  return domainRegex.test(domain);
}

// Функция для нормализации домена
function normalizeDomain(domain) {
  try {
    // Убираем пробелы
    domain = domain.trim();

    // Убираем http:// или https:// если есть
    domain = domain.replace(/^https?:\/\//, "");

    // Убираем все пробелы в домене
    domain = domain.replace(/\s+/g, "");

    // Убираем слеш в конце если есть
    domain = domain.replace(/\/$/, "");

    // Убираем www. если есть
    domain = domain.replace(/^www\./, "");

    // Проверяем валидность домена
    if (!isValidDomain(domain)) {
      throw new Error("Невірний формат домену");
    }

    return domain;
  } catch (error) {
    throw new Error("Помилка при обробці домену: " + error.message);
  }
}

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
  let results = "🕒 Автоматична перевірка доменів:\n\n";

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
    "Вітаю! Я бот для перевірки доменів.\n\n" +
      "Доступні команди:\n" +
      "/add domain.com - додати домен до списку\n" +
      "/remove domain.com - видалити домен зі списку\n" +
      "/list - показати список доменів\n" +
      "/check - перевірити всі домени в списку\n" +
      "/autocheck - увімкнути автоматичну перевірку кожні 12 годин\n\n" +
      "Ви можете додавати домени у будь-якому форматі:\n" +
      "- domain.com\n" +
      "- domain . com\n" +
      "- http://domain.com\n" +
      "- https://domain.com\n" +
      "- www.domain.com\n\n" +
      "Підтримуються будь-які домени з будь-якими TLD (наприклад: .com, .net, .org, .ru, .ua тощо)"
  );

  // Запускаем автоматическую проверку при старте
  startAutoCheck(chatId);
});

// Добавление домена
bot.onText(/\/add (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  try {
    const domain = normalizeDomain(match[1]);

    if (!userDomains.has(chatId)) {
      userDomains.set(chatId, new Set());
    }

    userDomains.get(chatId).add(domain);
    bot.sendMessage(chatId, `Домен ${domain} додано до списку!`);
  } catch (error) {
    bot.sendMessage(chatId, `Помилка: ${error.message}`);
  }
});

// Удаление домена
bot.onText(/\/remove (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  try {
    const domain = normalizeDomain(match[1]);

    if (userDomains.has(chatId) && userDomains.get(chatId).has(domain)) {
      userDomains.get(chatId).delete(domain);
      bot.sendMessage(chatId, `Домен ${domain} видалено зі списку!`);
    } else {
      bot.sendMessage(chatId, "Домен не знайдено в списку!");
    }
  } catch (error) {
    bot.sendMessage(chatId, `Помилка: ${error.message}`);
  }
});

// Показать список доменов
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;

  if (!userDomains.has(chatId) || userDomains.get(chatId).size === 0) {
    bot.sendMessage(chatId, "Список доменів порожній!");
    return;
  }

  const domains = Array.from(userDomains.get(chatId)).join("\n");
  bot.sendMessage(chatId, `Ваш список доменів:\n${domains}`);
});

// Проверка всех доменов
bot.onText(/\/check/, async (msg) => {
  const chatId = msg.chat.id;

  if (!userDomains.has(chatId) || userDomains.get(chatId).size === 0) {
    bot.sendMessage(chatId, "Список доменів порожній!");
    return;
  }

  const domains = Array.from(userDomains.get(chatId));
  let results = "Результати перевірки:\n\n";

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
    "Автоматична перевірка доменів увімкнена! Перевірка буде виконуватися кожні 12 годин."
  );
});
