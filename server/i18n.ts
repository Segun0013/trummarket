export const walletLocales = ["ru", "en"] as const;
export type WalletLocale = (typeof walletLocales)[number];

export function isWalletLocale(value: unknown): value is WalletLocale {
  return value === "ru" || value === "en";
}

const copy = {
  ru: {
    languagePrompt: "Добро пожаловать в Wallet — ваше личное пространство для денег.\n\nВыберите язык интерфейса:",
    languageSelected: "Русский выбран — настраиваю кошелёк.",
    welcome: (name: string) => `Готово, ${name}. Ваш кошелёк настроен: добавляйте доходы и расходы, а я помогу видеть финансовый ритм.`,
    openWallet: "Открыть кошелёк",
    balance: (current: string, income: string, expenses: string) => `Текущий баланс: ${current}\nВ этом месяце: +${income} · −${expenses}`,
    addUsage: (command: string) => `Используйте ${command} <сумма> <категория> [описание].\nПример: ${command} 2500 Зарплата Август`,
    saved: (kind: "income" | "expense", amount: string, category: string) => `${kind === "income" ? "Доход" : "Расход"} сохранён: ${amount} · ${category}`,
    preview: (kind: "income" | "expense", amount: string, category: string, description: string | null, confidence: number) => `Проверьте операцию:\n${kind === "income" ? "Доход" : "Расход"}: ${amount}\nКатегория: ${category}${description ? `\nОписание: ${description}` : ""}\nТочность: ${confidence}%`,
    previewConfirm: "Подтвердить",
    previewCancel: "Отменить",
    previewSaved: "Операция подтверждена и сохранена.",
    previewCancelled: "Черновик отменён.",
    previewHint: "Напишите операцию обычным сообщением, например: «Такси 450» или «зарплата 120000». Я предложу вариант и попрошу подтверждение.",
    mediaProcessing: "Обрабатываю запись и подготовлю черновик для подтверждения.",
    mediaHint: "Не удалось уверенно распознать сумму. Напишите сумму и категорию обычным сообщением — я подготовлю черновик.",
    available: "Доступные команды: /start, /balance, /add_income, /add_expense, /help, /settings.",
    help: "Как пользоваться Wallet\n\n• Напишите «такси 450» или «зарплата 120000» — я подготовлю операцию для подтверждения.\n• Отправьте голосовое сообщение или фото чека — результат тоже нужно будет подтвердить.\n• /balance — баланс и итоги месяца.\n• /add_income и /add_expense — точный ручной ввод.\n• /settings — напоминания, отчёты и часовой пояс.",
    settings: "Откройте настройки кошелька, чтобы изменить язык, часовой пояс, ежедневное напоминание и периодические отчёты.",
    reminder: (expenses: string, income: string) => `Вечерняя проверка кошелька\nСегодня: доходы ${income} · расходы ${expenses}\n\nОткройте кошелёк, чтобы добавить забытые операции или посмотреть детали.`,
    report: (period: string, income: string, expenses: string, net: string, rate: number | null) => `Сводка за ${period}\nДоходы: ${income}\nРасходы: ${expenses}\nИтог: ${net}${rate === null ? "" : `\nДоля сбережений: ${rate}%`}\n\nОткройте кошелёк, чтобы увидеть динамику и лимиты.`,
    invitationAccepted: (accountName: string) => `Готово — вы присоединились к общему кошельку «${accountName}». Откройте кошелёк, чтобы вести общий бюджет.`,
    invitationError: "Эта ссылка-приглашение недействительна, истекла или уже использована.",
    error: "Не удалось сохранить операцию. Проверьте сумму и попробуйте снова.",
  },
  en: {
    languagePrompt: "Welcome to Wallet — your private money space.\n\nChoose your interface language:",
    languageSelected: "English selected — preparing your wallet.",
    welcome: (name: string) => `You're all set, ${name}. Add income and expenses, and I'll help you keep your financial rhythm in view.`,
    openWallet: "Open my wallet",
    balance: (current: string, income: string, expenses: string) => `Current balance: ${current}\nThis month: +${income} · −${expenses}`,
    addUsage: (command: string) => `Use ${command} <amount> <category> [description].\nExample: ${command} 2500 Salary August`,
    saved: (kind: "income" | "expense", amount: string, category: string) => `${kind === "income" ? "Income" : "Expense"} saved: ${amount} · ${category}`,
    preview: (kind: "income" | "expense", amount: string, category: string, description: string | null, confidence: number) => `Review this transaction:\n${kind === "income" ? "Income" : "Expense"}: ${amount}\nCategory: ${category}${description ? `\nDescription: ${description}` : ""}\nConfidence: ${confidence}%`,
    previewConfirm: "Confirm",
    previewCancel: "Cancel",
    previewSaved: "Transaction confirmed and saved.",
    previewCancelled: "Draft cancelled.",
    previewHint: "Send an everyday message such as “Taxi 450” or “salary 120000”. I will suggest a transaction and ask for your confirmation.",
    mediaProcessing: "I’m processing this entry and will prepare a draft for your confirmation.",
    mediaHint: "I could not confidently read the amount. Send an everyday message with an amount and category, and I will prepare a draft.",
    available: "Available commands: /start, /balance, /add_income, /add_expense, /help, /settings.",
    help: "How to use Wallet\n\n• Send “Taxi 450” or “salary 120000” and I will prepare a transaction for confirmation.\n• Send a voice note or receipt photo; its result also requires confirmation.\n• /balance — balance and monthly totals.\n• /add_income and /add_expense — precise manual entry.\n• /settings — reminders, reports and timezone.",
    settings: "Open wallet settings to change your language, timezone, daily reminder and periodic reports.",
    reminder: (expenses: string, income: string) => `Your evening wallet check-in\nToday: income ${income} · expenses ${expenses}\n\nOpen your wallet to add anything you missed or view the details.`,
    report: (period: string, income: string, expenses: string, net: string, rate: number | null) => `${period} summary\nIncome: ${income}\nExpenses: ${expenses}\nNet: ${net}${rate === null ? "" : `\nSavings rate: ${rate}%`}\n\nOpen your wallet to review the trend and budgets.`,
    invitationAccepted: (accountName: string) => `You’re in — you joined the shared wallet “${accountName}”. Open your wallet to start managing the shared budget.`,
    invitationError: "This invitation link is invalid, expired, or has already been used.",
    error: "I could not save that transaction. Please check the amount and try again.",
  },
} as const;

export function botCopy(locale: WalletLocale) {
  return copy[locale];
}

export const bilingualBotDescription = "Wallet — личный учёт доходов и расходов.\n\nWallet — private income and expense tracking.";
export const bilingualBotShortDescription = "Личный кошелёк / Private wallet";
