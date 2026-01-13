const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// Config
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;

// 1. /start - Yangi foydalanuvchini ro'yxatga olish va Adminga xabar berish
bot.start(async (ctx) => {
    const { id, username, first_name } = ctx.from;
    
    // Bazada borligini tekshirish
    let { data: user, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', id)
        .single();

    if (!user) {
        const { data: newUser } = await supabase
            .from('profiles')
            .insert([{ telegram_id: id, username, full_name: first_name }])
            .select().single();
        user = newUser;

        // Adminga xabar yuborish
        await bot.telegram.sendMessage(ADMIN_ID, `Yangi foydalanuvchi: ${first_name} (@${username}). Uni jamoaga qo'shasizmi?`, 
            Markup.inlineKeyboard([
                Markup.button.callback('Jamoaga qo\'shish', `assign_${user.id}`)
            ])
        );
    }
    
    ctx.reply("Xush kelibsiz! Admin sizni jamoaga qo'shishini kuting.", 
        Markup.keyboard([Markup.button.webApp('Mini Appni ochish', process.env.WEBAPP_URL)]).resize()
    );
});

// 2. Vazifa biriktirilganda bildirishnoma yuborish (Internal Function)
async function notifyUser(userId, taskTitle) {
    const { data: user } = await supabase.from('profiles').select('telegram_id').eq('id', userId).single();
    if (user) {
        await bot.telegram.sendMessage(user.telegram_id, `🚀 Sizga yangi vazifa biriktirildi: **${taskTitle}**`);
    }
}

// 3. Team yaratish (Bot orqali)
bot.command('newteam', async (ctx) => {
    const teamName = ctx.message.text.split(' ').slice(1).join(' ');
    if (!teamName) return ctx.reply("Jamoa nomini yozing: /newteam TeamName");

    const { data: user } = await supabase.from('profiles').select('id').eq('telegram_id', ctx.from.id).single();
    const { data: team } = await supabase.from('teams').insert([{ name: teamName, created_by: user.id }]).select().single();
    
    await supabase.from('team_members').insert([{ team_id: team.id, user_id: user.id }]);
    ctx.reply(`"${teamName}" jamoasi yaratildi!`);
});

// Vercel uchun export
module.exports = async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (err) {
        res.status(500).send(err.message);
    }
};