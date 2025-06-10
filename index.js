/** @format */

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// Инициализация бота с polling и обработкой ошибок
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10,
    },
  },
});

// Обработка ошибок polling
bot.on("polling_error", (error) => {
  console.error("Polling error:", error.message);
  if (error.message.includes("409 Conflict")) {
    console.log("Перезапуск polling...");
    bot.stopPolling().then(() => {
      setTimeout(() => {
        bot.startPolling();
      }, 1000);
    });
  }
});

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
  const results = [];

  // Проверяем все домены и сохраняем результаты
  for (const domain of domains) {
    const isAvailable = await checkDomain(domain);
    results.push({
      domain: domain,
      isAvailable: isAvailable,
    });
  }

  // Сортируем результаты: сначала недоступные, потом доступные
  results.sort((a, b) => {
    if (a.isAvailable === b.isAvailable) {
      return a.domain.localeCompare(b.domain); // Сортировка по алфавиту внутри групп
    }
    return a.isAvailable ? 1 : -1; // Недоступные сначала
  });

  // Формируем сообщение
  let message = "🕒 Автоматична перевірка доменів:\n\n";

  // Добавляем недоступные домены
  const unavailableDomains = results.filter((r) => !r.isAvailable);
  if (unavailableDomains.length > 0) {
    message += "❌ Недоступні домени:\n";
    unavailableDomains.forEach((r) => {
      message += `${r.domain}\n`;
    });
    message += "\n";
  }

  // Добавляем доступные домены
  const availableDomains = results.filter((r) => r.isAvailable);
  if (availableDomains.length > 0) {
    message += "✅ Доступні домени:\n";
    availableDomains.forEach((r) => {
      message += `${r.domain}\n`;
    });
  }

  bot.sendMessage(chatId, message);
}

// Функция для запуска автоматической проверки
function startAutoCheck(chatId) {
  // Функция для расчета времени до следующей проверки
  function getTimeUntilNextCheck() {
    const now = new Date();
    const nextCheck = new Date(now);
    nextCheck.setHours(12, 0, 0, 0);

    // Если текущее время уже после 12:00, планируем на следующий день
    if (now > nextCheck) {
      nextCheck.setDate(nextCheck.getDate() + 1);
    }

    return nextCheck.getTime() - now.getTime();
  }

  // Функция для планирования следующей проверки
  function scheduleNextCheck() {
    const timeUntilNextCheck = getTimeUntilNextCheck();
    setTimeout(() => {
      sendCheckResults(chatId);
      scheduleNextCheck(); // Планируем следующую проверку
    }, timeUntilNextCheck);
  }

  // Запускаем первую проверку
  scheduleNextCheck();
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
      "/autocheck - увімкнути автоматичну перевірку о 12:00 щодня\n\n" +
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
  const results = [];

  // Проверяем все домены и сохраняем результаты
  for (const domain of domains) {
    const isAvailable = await checkDomain(domain);
    results.push({
      domain: domain,
      isAvailable: isAvailable,
    });
  }

  // Сортируем результаты: сначала недоступные, потом доступные
  results.sort((a, b) => {
    if (a.isAvailable === b.isAvailable) {
      return a.domain.localeCompare(b.domain); // Сортировка по алфавиту внутри групп
    }
    return a.isAvailable ? 1 : -1; // Недоступные сначала
  });

  // Формируем сообщение
  let message = "Результати перевірки:\n\n";

  // Добавляем недоступные домены
  const unavailableDomains = results.filter((r) => !r.isAvailable);
  if (unavailableDomains.length > 0) {
    message += "❌ Недоступні домени:\n";
    unavailableDomains.forEach((r) => {
      message += `${r.domain}\n`;
    });
    message += "\n";
  }

  // Добавляем доступные домены
  const availableDomains = results.filter((r) => r.isAvailable);
  if (availableDomains.length > 0) {
    message += "✅ Доступні домени:\n";
    availableDomains.forEach((r) => {
      message += `${r.domain}\n`;
    });
  }

  bot.sendMessage(chatId, message);
});

// Команда для включения автоматической проверки
bot.onText(/\/autocheck/, (msg) => {
  const chatId = msg.chat.id;
  startAutoCheck(chatId);
  bot.sendMessage(
    chatId,
    "Автоматична перевірка доменів увімкнена! Перевірка буде виконуватися о 12:00 щодня."
  );
});
