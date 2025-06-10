/** @format */

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

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

    // Убираем все недопустимые символы, оставляя только буквы, цифры, точки и дефисы
    domain = domain.replace(/[^a-zA-Z0-9.-]/g, "");

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

// Функция для инициализации бота
async function initializeBot() {
  try {
    // Сначала удаляем все webhook'и
    const tempBot = new TelegramBot(process.env.BOT_TOKEN);
    await tempBot.deleteWebHook();

    // Создаем основной экземпляр бота
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
    bot.on("polling_error", async (error) => {
      console.error("Polling error:", error.message);
      if (error.message.includes("409 Conflict")) {
        console.log("Спроба вирішити конфлікт polling...");
        try {
          // Останавливаем текущий polling
          await bot.stopPolling();
          // Удаляем webhook
          await bot.deleteWebHook();
          // Ждем немного
          await new Promise((resolve) => setTimeout(resolve, 2000));
          // Запускаем polling заново
          await bot.startPolling();
          console.log("Polling успішно перезапущено");
        } catch (restartError) {
          console.error(
            "Помилка при перезапуску polling:",
            restartError.message
          );
        }
      }
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

    bot.onText(/\/add (.+)/, (msg, match) => {
      const chatId = msg.chat.id;
      try {
        console.log("Отримано команду /add з параметрами:", match[1]);

        // Разбиваем строку на домены по запятой или переносу строки
        const domains = match[1]
          .split(/[,\n]/) // Разделяем по запятой или переносу строки
          .map((d) => d.trim()) // Убираем пробелы
          .filter((d) => d.length > 0); // Убираем пустые строки

        console.log("Розділені домени:", domains);

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

    bot.onText(/\/remove (.+)/, (msg, match) => {
      const chatId = msg.chat.id;
      try {
        // Разбиваем строку на домены по запятой
        const domains = match[1].split(",").map((d) => d.trim());

        if (!userDomains.has(chatId)) {
          bot.sendMessage(chatId, "Список доменів порожній!");
          return;
        }

        const removedDomains = [];
        const notFoundDomains = [];

        // Обрабатываем каждый домен
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

        // Формируем сообщение о результатах
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
    process.exit(1);
  });
