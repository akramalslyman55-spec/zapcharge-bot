import os
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

BOT_TOKEN = os.environ.get("BOT_TOKEN")
STORE_URL = "https://zapcharge-bot-production.up.railway.app"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("فتح المتجر ⚡", web_app=WebAppInfo(url=STORE_URL))],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "أهلاً فيك بـZapcharge ⚡\n"
        "شحن فوري وآمن لجميع الألعاب والتطبيقات والاشتراكات.\n\n"
        "اضغط الزر تحت لفتح المتجر:",
        reply_markup=reply_markup
    )

def main():
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    print("البوت شغال...")
    app.run_polling()

if __name__ == "__main__":
    main()
    
