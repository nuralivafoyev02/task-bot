const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const OWNER_ID = parseInt(process.env.OWNER_ID);
const WEBAPP_URL = process.env.WEBAPP_URL;

// Asosiy menyu tugmasi
const mainMenu = Markup.keyboard([
    [Markup.button.webApp('Vazifalarni boshqarish 📱', WEBAPP_URL)],
    [Markup.button.callback('Yordam ❓', 'help')]
]).resize();

// 1. START - Ro'yxatdan o'tish va Ownerga xabar
bot.start(async (ctx) => {
    const { id, username, first_name } = ctx.from;
    
    let { data: profile } = await supabase.from('profiles').select('*').eq('telegram_id', id).single();

    if (!profile) {
        const role = id === OWNER_ID ? 'owner' : 'user';
        const { data: newProfile } = await supabase
            .from('profiles')
            .insert([{ telegram_id: id, username, full_name: first_name, role }])
            .select().single();
        profile = newProfile;

        if (id !== OWNER_ID) {
            bot.telegram.sendMessage(OWNER_ID, `🆕 Yangi user: ${first_name} (@${username})\nID: ${id}`, 
                Markup.inlineKeyboard([
                    [Markup.button.callback('Admin qilish ⚡️', `make_admin_${id}`)],
                    [Markup.button.callback('Jamoaga qo\'shish 👥', `assign_team_${id}`)]
                ])
            );
        }
    }

    ctx.reply(`Xush kelibsiz, ${profile.full_name}! Holatingiz: ${profile.role.toUpperCase()}`, mainMenu);
});

// 2. ADMIN TAYINLASH (Faqat Owner uchun)
bot.action(/make_admin_(\d+)/, async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return ctx.answerCbQuery("Taqiqlangan!");
    const targetId = ctx.match[1];
    
    await supabase.from('profiles').update({ role: 'admin' }).eq('telegram_id', targetId);
    bot.telegram.sendMessage(targetId, "Tabriklaymiz! Siz Admin bo'ldingiz. Endi /newteam komandasini ishlata olasiz.");
    ctx.editMessageText("✅ Foydalanuvchi Admin qilindi.");
});

// 3. JAMOA YARATISH (/newteam Nomi)
bot.command('newteam', async (ctx) => {
    const { data: user } = await supabase.from('profiles').select('id, role').eq('telegram_id', ctx.from.id).single();
    if (user.role === 'user') return ctx.reply("❌ Faqat Admin yoki Owner jamoa ochishi mumkin.");

    const name = ctx.message.text.split(' ').slice(1).join(' ');
    if (!name) return ctx.reply("⚠️ Format: /newteam Jamoa_Nomi");

    const { data: team } = await supabase.from('teams').insert([{ name, created_by: user.id }]).select().single();
    await supabase.from('team_members').insert([{ team_id: team.id, user_id: user.id }]);
    
    ctx.reply(`✅ "${name}" jamoasi yaratildi. Uni boshqarish uchun Mini Appga kiring.`, mainMenu);
});

// 4. JAMOA GA QO'SHISH (Inline buttons)
bot.action(/assign_team_(\d+)/, async (ctx) => {
    const { data: teams } = await supabase.from('teams').select('*');
    const targetTgId = ctx.match[1];
    
    const buttons = teams.map(t => [Markup.button.callback(t.name, `add_to_team_${t.id}_${targetTgId}`)]);
    ctx.reply("Jamoani tanlang:", Markup.inlineKeyboard(buttons));
});

bot.action(/add_to_team_(.+)_(\d+)/, async (ctx) => {
    const [_, teamId, targetTgId] = ctx.match;
    const { data: user } = await supabase.from('profiles').select('id').eq('telegram_id', targetTgId).single();
    
    await supabase.from('team_members').insert([{ team_id: teamId, user_id: user.id }]);
    bot.telegram.sendMessage(targetTgId, "Siz yangi jamoaga qo'shildingiz! Mini Appni tekshiring.");
    ctx.editMessageText("✅ Jamoaga muvaffaqiyatli qo'shildi.");
});

// 5. VAZIFA YARATISH (/newtask @username Vazifa)
bot.command('newtask', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("⚠️ Format: /newtask @username Vazifa matni");

    const targetUser = parts[1].replace('@', '');
    const title = parts.slice(2).join(' ');

    const { data: creator } = await supabase.from('profiles').select('id, current_team_id, role').eq('telegram_id', ctx.from.id).single();
    if (creator.role === 'user') return ctx.reply("❌ Sizda vazifa yaratish huquqi yo'q.");
    if (!creator.current_team_id) return ctx.reply("❌ Avval Mini Appda jamoani tanlang (Switch team).");

    const { data: worker } = await supabase.from('profiles').select('id, telegram_id').eq('username', targetUser).single();
    if (!worker) return ctx.reply("❌ Bunday foydalanuvchi botda yo'q.");

    await supabase.from('tasks').insert([{
        title, team_id: creator.current_team_id, assigned_to: worker.id, created_by: creator.id
    }]);

    ctx.reply("🚀 Vazifa yaratildi!", mainMenu);
    bot.telegram.sendMessage(worker.telegram_id, `📩 Yangi vazifa: "${title}"\nKimdan: @${ctx.from.username}`);
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } else {
        res.status(200).send('Bot Active');
    }
};