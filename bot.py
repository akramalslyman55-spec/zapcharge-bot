import os
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

BOT_TOKEN = os.environ.get("BOT_TOKEN")
STORE_URL = "https://zapcharge-bot-production.up.railway.app"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # لو المستخدم فتح البوت عبر رابط إحالة (t.me/ZapchargeBot?start=ref_123456789)
    # تيليجرام بيبعت "ref_123456789" كأول عنصر بـ context.args
    store_url = STORE_URL
    if context.args:
        param = context.args[0]
        if param.startswith("ref_"):
            referrer_id = param[4:]
            if referrer_id.isdigit():
                store_url = f"{STORE_URL}?ref={referrer_id}"

    keyboard = [
        [InlineKeyboardButton("فتح المتجر ⚡", web_app=WebAppInfo(url=store_url))],
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
