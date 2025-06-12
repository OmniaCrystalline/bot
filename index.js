/** @format */

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const http = require("http");

// Получаем порт из переменных окружения или используем порт по умолчанию
const PORT = process.env.PORT || 3000;

// Создаем HTTP-сервер для health-check
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ status: "ok", timestamp: new Date().toISOString() })
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Запускаем сервер
server.listen(PORT, () => {
  console.log(`HTTP сервер запущено на порту ${PORT}`);
});

// Путь к файлу с доменами
const DOMAINS_FILE = path.join(__dirname, "domains.json");

// Функция для загрузки доменов из файла
function loadDomains() {
  try {
    if (fs.existsSync(DOMAINS_FILE)) {
      const data = fs.readFileSync(DOMAINS_FILE, "utf8");
      const domains = JSON.parse(data);

      // Перевіряємо структуру даних
      if (typeof domains !== "object") {
        throw new Error("Невірний формат даних");
      }

      // Перетворюємо звичайні об'єкти назад в Map
      const userDomains = new Map();
      for (const [chatId, domainSet] of Object.entries(domains)) {
        if (!Array.isArray(domainSet)) {
          console.warn(
            `Пропущено невалідний набір доменів для chatId ${chatId}`
          );
          continue;
        }
        userDomains.set(chatId, new Set(domainSet));
      }

      console.log("Дані успішно завантажено");
      return userDomains;
    }
  } catch (error) {
    console.error("Помилка при завантаженні доменів:", error);
  }
  return new Map();
}

// Функция для сохранения доменов в файл
function saveDomains(userDomains) {
  try {
    // Створюємо тимчасовий файл
    const tempFile = `${DOMAINS_FILE}.tmp`;

    // Перетворюємо Map в звичайний об'єкт для збереження
    const domains = {};
    for (const [chatId, domainSet] of userDomains.entries()) {
      domains[chatId] = Array.from(domainSet);
    }

    // Спочатку записуємо в тимчасовий файл
    fs.writeFileSync(tempFile, JSON.stringify(domains, null, 2));

    // Перевіряємо, що тимчасовий файл створено і містить валідний JSON
    const tempData = fs.readFileSync(tempFile, "utf8");
    JSON.parse(tempData); // Перевірка на валідність JSON

    // Якщо все добре, переміщуємо тимчасовий файл на місце основного
    fs.renameSync(tempFile, DOMAINS_FILE);

    console.log("Дані успішно збережено");
  } catch (error) {
    console.error("Помилка при збереженні доменів:", error);
    // Якщо є тимчасовий файл, видаляємо його
    if (fs.existsSync(`${DOMAINS_FILE}.tmp`)) {
      fs.unlinkSync(`${DOMAINS_FILE}.tmp`);
    }
  }
}

// Хранение списка доменов для каждого пользователя
const userDomains = loadDomains();

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

    // Убираем все недопустимые символы, оставляя только буквы, цифры, точки, дефисы и подчеркивания
    domain = domain.replace(/[^a-zA-Z0-9._-]/g, "");

    // Проверяем, что домен не пустой после очистки
    if (!domain) {
      throw new Error("Домен порожній після очищення");
    }

    // Проверяем, что домен содержит хотя бы одну точку
    if (!domain.includes(".")) {
      throw new Error("Домен повинен містити хоча б одну точку");
    }

    // Проверяем, что домен не начинается и не заканчивается точкой или дефисом
    if (
      domain.startsWith(".") ||
      domain.endsWith(".") ||
      domain.startsWith("-") ||
      domain.endsWith("-")
    ) {
      throw new Error(
        "Домен не може починатися або закінчуватися точкою або дефісом"
      );
    }

    // Проверяем, что нет двух точек или дефисов подряд
    if (domain.includes("..") || domain.includes("--")) {
      throw new Error("Домен не може містити дві точки або дефіси підряд");
    }

    // Проверяем длину каждой части домена
    const parts = domain.split(".");
    for (const part of parts) {
      if (part.length > 63) {
        throw new Error(
          "Кожна частина домену не може бути довшою за 63 символи"
        );
      }
    }

    // Проверяем общую длину домена
    if (domain.length > 255) {
      throw new Error(
        "Загальна довжина домену не може перевищувати 255 символів"
      );
    }

    return domain.toLowerCase();
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

// Функция для перезапуску бота
async function restartBot() {
  console.log("Спроба перезапуску бота...");
  try {
    if (bot) {
      await bot.stopPolling();
    }
    bot = await initializeBot();
    console.log("Бот успішно перезапущено");
  } catch (error) {
    console.error("Помилка при перезапуску бота:", error.message);
    // Пробуємо перезапустити через 30 секунд
    setTimeout(restartBot, 30000);
  }
}

// Функция для инициализации бота
async function initializeBot() {
  try {
    // Спочатку видаляємо всі webhook'и
    const tempBot = new TelegramBot(process.env.BOT_TOKEN);
    await tempBot.deleteWebHook();

    // Створюємо основний екземпляр бота з покращеними налаштуваннями
    const bot = new TelegramBot(process.env.BOT_TOKEN, {
      polling: {
        interval: 300,
        autoStart: true,
        params: {
          timeout: 30,
        },
        retryAfter: 5,
      },
      request: {
        timeout: 30000,
        proxy: process.env.HTTPS_PROXY,
      },
    });

    // Покращена обробка помилок polling
    bot.on("polling_error", async (error) => {
      console.error("Polling error:", error.message);

      if (
        error.message.includes("409 Conflict") ||
        error.message.includes("ECONNRESET") ||
        error.message.includes("ETIMEDOUT")
      ) {
        console.log("Спроба перезапуску через помилку polling...");
        setTimeout(restartBot, 5000);
      }
    });

    // Додаємо обробник для загальної помилки
    bot.on("error", (error) => {
      console.error("Загальна помилка бота:", error.message);
      setTimeout(restartBot, 5000);
    });

    // Обработчики команд
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(
        chatId,
        "Вітаю! Я бот для перевірки доменів.\n\n" +
          "Доступні команди:\n" +
          "/add domain1.com, domain2.com - додати один або кілька доменів до списку\n" +
          "/remove domain1.com, domain2.com - видалити один або кілька доменів зі списку\n" +
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

    bot.onText(/\/add/, (msg) => {
      const chatId = msg.chat.id;
      try {
        // Получаем текст сообщения
        const text = msg.text;
        console.log("Отримано повне повідомлення:", text);

        // Убираем команду /add и разбиваем на строки
        const domainsText = text.replace(/^\/add\s*/, "").trim();
        console.log("Текст після видалення команди:", domainsText);

        // Разбиваем на домены по переносу строки или запятой
        const domains = domainsText
          .split(/[\n,]+/) // Разделяем по переносу строки или запятой
          .map((d) => d.trim()) // Убираем пробелы
          .filter((d) => d.length > 0); // Убираем пустые строки

        console.log("Розділені домени (сирий список):", domains);

        if (!userDomains.has(chatId)) {
          userDomains.set(chatId, new Set());
          console.log("Створено новий набір доменів для chatId:", chatId);
        }

        const addedDomains = [];
        const errors = [];

        // Обрабатываем каждый домен
        for (const domain of domains) {
          try {
            console.log("Спроба нормалізації домену:", domain);
            const normalizedDomain = normalizeDomain(domain);
            console.log("Нормалізований домен:", normalizedDomain);

            userDomains.get(chatId).add(normalizedDomain);
            addedDomains.push(normalizedDomain);
            console.log("Домен успішно додано:", normalizedDomain);
          } catch (error) {
            console.error("Помилка при обробці домену:", domain, error.message);
            errors.push(`${domain}: ${error.message}`);
          }
        }

        // Сохраняем домены после добавления
        saveDomains(userDomains);

        // Формируем сообщение о результатах
        let message = "";
        if (addedDomains.length > 0) {
          message += `✅ Успішно додано доменів: ${addedDomains.length}\n`;
          message += addedDomains.join("\n") + "\n\n";
        }

        if (errors.length > 0) {
          message += `❌ Помилки при додаванні:\n`;
          message += errors.join("\n");
        }

        console.log("Відправляємо повідомлення:", message);
        bot.sendMessage(chatId, message || "Не вдалося додати жодного домену");
      } catch (error) {
        console.error("Загальна помилка при додаванні доменів:", error);
        bot.sendMessage(chatId, `Помилка: ${error.message}`);
      }
    });

    bot.onText(/\/remove/, (msg) => {
      const chatId = msg.chat.id;
      try {
        const text = msg.text;
        const domainsText = text.replace(/^\/remove\s*/, "").trim();
        const domains = domainsText
          .split(/[\n,]+/)
          .map((d) => d.trim())
          .filter((d) => d.length > 0);

        if (!userDomains.has(chatId)) {
          bot.sendMessage(chatId, "Список доменів порожній!");
          return;
        }

        const removedDomains = [];
        const notFoundDomains = [];

        for (const domain of domains) {
          try {
            const normalizedDomain = normalizeDomain(domain);
            if (userDomains.get(chatId).has(normalizedDomain)) {
              userDomains.get(chatId).delete(normalizedDomain);
              removedDomains.push(normalizedDomain);
            } else {
              notFoundDomains.push(normalizedDomain);
            }
          } catch (error) {
            notFoundDomains.push(`${domain}: ${error.message}`);
          }
        }

        // Сохраняем домены после удаления
        saveDomains(userDomains);

        let message = "";
        if (removedDomains.length > 0) {
          message += `✅ Успішно видалено доменів: ${removedDomains.length}\n`;
          message += removedDomains.join("\n") + "\n\n";
        }

        if (notFoundDomains.length > 0) {
          message += `❌ Не знайдено в списку:\n`;
          message += notFoundDomains.join("\n");
        }

        bot.sendMessage(
          chatId,
          message || "Не вдалося видалити жодного домену"
        );
      } catch (error) {
        bot.sendMessage(chatId, `Помилка: ${error.message}`);
      }
    });

    bot.onText(/\/list/, (msg) => {
      const chatId = msg.chat.id;

      if (!userDomains.has(chatId) || userDomains.get(chatId).size === 0) {
        bot.sendMessage(chatId, "Список доменів порожній!");
        return;
      }

      const domains = Array.from(userDomains.get(chatId)).join("\n");
      bot.sendMessage(chatId, `Ваш список доменів:\n${domains}`);
    });

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

    bot.onText(/\/autocheck/, (msg) => {
      const chatId = msg.chat.id;
      startAutoCheck(chatId);
      bot.sendMessage(
        chatId,
        "Автоматична перевірка доменів увімкнена! Перевірка буде виконуватися о 12:00 щодня."
      );
    });

    return bot;
  } catch (error) {
    console.error("Помилка при ініціалізації бота:", error.message);
    throw error;
  }
}

// Инициализация бота
let bot;
initializeBot()
  .then((initializedBot) => {
    bot = initializedBot;
    console.log("Бот успішно ініціалізовано");
  })
  .catch((error) => {
    console.error("Не вдалося ініціалізувати бота:", error.message);
    // Замість завершення роботи, пробуємо перезапустити через 30 секунд
    setTimeout(restartBot, 30000);
  });

// Функция для корректного завершения работы
async function gracefulShutdown() {
  console.log("Починаємо процес завершення роботи...");

  try {
    // Зупиняємо бота
    if (bot) {
      console.log("Зупиняємо бота...");
      await bot.stopPolling();
      console.log("Бот зупинено");
    }

    // Закриваємо HTTP-сервер
    console.log("Закриваємо HTTP сервер...");
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          console.error("Помилка при закритті сервера:", err);
          reject(err);
        } else {
          console.log("HTTP сервер закрито");
          resolve();
        }
      });
    });

    // Зберігаємо дані перед виходом
    console.log("Зберігаємо дані...");
    saveDomains(userDomains);
    console.log("Дані збережено");

    console.log("Завершення роботи успішне");
    process.exit(0);
  } catch (error) {
    console.error("Помилка при завершенні роботи:", error);
    process.exit(1);
  }
}

// Обробка сигналів завершення
process.on("SIGTERM", () => {
  console.log("Отримано сигнал SIGTERM");
  gracefulShutdown();
});

process.on("SIGINT", () => {
  console.log("Отримано сигнал SIGINT");
  gracefulShutdown();
});

// Обробка необроблених помилок
process.on("uncaughtException", (error) => {
  console.error("Необроблена помилка:", error);
  // Замість завершення роботи, пробуємо перезапустити бота
  setTimeout(restartBot, 5000);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Необроблена відмова промісу:", reason);
  // Замість завершення роботи, пробуємо перезапустити бота
  setTimeout(restartBot, 5000);
});

// Функція для автоматичного збереження при змінах
function autoSave() {
  saveDomains(userDomains);
}

// Додаємо автоматичне збереження кожні 5 хвилин
setInterval(autoSave, 5 * 60 * 1000);
