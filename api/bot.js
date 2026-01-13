const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_ID = parseInt(process.env.OWNER_ID);
const WEBAPP_URL = process.env.WEBAPP_URL;

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ROLE CHECK MIDDLEWARE
const requireRole = (roles = []) => async (ctx, next) => {
    const { data: user, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('telegram_id', ctx.from.id)
        .single();

    if (error || !user || !roles.includes(user.role)) {
        return ctx.reply("❌ Sizda bu amal uchun ruxsat yo‘q.");
    }
    return next();
};

// Har bir rol uchun maxsus tugmalar
const getMenuByRole = (role) => {
    const buttons = [[Markup.button.webApp('Ilovani ochish 📱', WEBAPP_URL)]];
    
    if (role === 'owner' || role === 'admin') {
        buttons.push([Markup.button.text('➕ Yangi vazifa'), Markup.button.text('👥 Jamoalarim')]);
    }
    
    if (role === 'owner') {
        buttons.push([Markup.button.text('📊 Foydalanuvchilar'), Markup.button.text('⚙️ Tizim holati')]);
    }

    return Markup.keyboard(buttons).resize();
};

// Har bir rol uchun yozma yo'riqnoma
const getHelpText = (role, name) => {
    let text = `Salom, ${name}! Sizning darajangiz: *${role.toUpperCase()}*\n\n`;
    
    if (role === 'user') {
        text += "📖 *Buyruqlar:*\n/start - Menyuni yangilash\n/mytasks - Vazifalarimni ko'rish (Ilovada)";
    } else if (role === 'admin') {
        text += "🛠 *Admin buyruqlari:*\n/newtask - Vazifa biriktirish\n/newteam - Jamoa ochish\n/teams - Jamoalarni boshqarish";
    } else if (role === 'owner') {
        text += "👑 *Owner buyruqlari:*\n/users - Barcha foydalanuvchilar\n/newadmin - Admin tayinlash\n/alltasks - Barcha vazifalar nazorati";
    }
    return text;
};

// --- BOT LOGIKASI ---

bot.start(async (ctx) => {
    try {
        const { id, username, first_name } = ctx.from;
        
        const { data: profile, error } = await supabase
            .from('profiles')
            .upsert({ 
                telegram_id: id, 
                username: username || 'user', 
                full_name: first_name,
                role: id === OWNER_ID ? 'owner' : 'user'
            }, { onConflict: 'telegram_id' })
            .select().single();

        if (error) throw error;

        await ctx.reply(getHelpText(profile.role, first_name), {
            parse_mode: 'Markdown',
            ...getMenuByRole(profile.role)
        });

        if (id !== OWNER_ID && !error) { // Faqat birinchi marta kirganda bildirishnoma (ixtiyoriy)
             // Eski xabardor qilish kodi o'z joyida
        }
    } catch (err) {
        console.error("Start Error:", err);
    }
});

// --- OWNER EXCLUSIVE FEATURES ---

bot.hears(
    '📊 Foydalanuvchilar',
    requireRole(['owner']),
    async (ctx) => {
        const { data: users, error } = await supabase
            .from('profiles')
            .select('full_name, username, role')
            .limit(30);

        if (error) {
            console.error(error);
            return ctx.reply("⚠️ Xatolik yuz berdi.");
        }

        let text = "👥 *Foydalanuvchilar ro‘yxati:*\n\n";
        users.forEach(u => {
            const icon =
                u.role === 'owner' ? '👑' :
                u.role === 'admin' ? '⚡️' : '👤';

            text += `${icon} ${u.full_name} — @${u.username}\n`;
        });

        ctx.reply(text, { parse_mode: 'Markdown' });
    }
);


bot.command('users', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return;
    // Yuqoridagi mantiq bilan bir xil
    ctx.reply("Foydalanuvchilar tugmasini bosing yoki yuqoridagi ro'yxatni ko'ring.");
});

// --- ADMIN & OWNER FEATURES ---

bot.hears('➕ Yangi vazifa', (ctx) => ctx.reply("Vazifa yaratish uchun: `/newtask @username Vazifa nomi`", { parse_mode: 'Markdown' }));
bot.hears('👥 Jamoalarim', (ctx) => ctx.reply("Jamoalarni boshqarish uchun Mini Ilovaga kiring yoki /newteam buyrug'idan foydalaning."));

// --- OLD FUNCTIONS (SAQLAB QOLINGAN) ---

bot.action(/make_admin_(\d+)/, async (ctx) => {
    try {
        if (ctx.from.id !== OWNER_ID) return ctx.answerCbQuery("Taqiqlangan!");
        const targetId = ctx.match[1];
        await supabase.from('profiles').update({ role: 'admin' }).eq('telegram_id', targetId);
        bot.telegram.sendMessage(targetId, "🎉 Tabriklaymiz! Siz Admin bo'ldingiz.");
        ctx.editMessageText("✅ Foydalanuvchi Admin qilindi.");
    } catch (e) { console.error(e); }
});

bot.command('newteam', async (ctx) => {
    const { data: user } = await supabase.from('profiles').select('id, role').eq('telegram_id', ctx.from.id).single();
    if (user.role === 'user') return ctx.reply("❌ Faqat Adminlar jamoa ochishi mumkin.");
    const name = ctx.message.text.split(' ').slice(1).join(' ');
    if (!name) return ctx.reply("⚠️ Format: `/newteam JamoaNomi`", { parse_mode: 'Markdown' });
    const { data: team } = await supabase.from('teams').insert([{ name, created_by: user.id }]).select().single();
    await supabase.from('team_members').insert([{ team_id: team.id, user_id: user.id }]);
    ctx.reply(`✅ **${name}** jamoasi yaratildi.`, { parse_mode: 'Markdown' });
});

bot.command('newtask', async (ctx) => {
    const { data: creator, error: creatorError } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', ctx.from.id)
        .single();

    if (creatorError || creator.role === 'user') {
        return ctx.reply("❌ Sizda vazifa biriktirish huquqi yo‘q.");
    }

    let worker;
    let title;

    // 🔹 1. REPLY ORQALI VAZIFA BERISH
    if (ctx.message.reply_to_message) {
        title = ctx.message.text.split(' ').slice(1).join(' ');

        if (!title) {
            return ctx.reply("⚠️ Vazifa nomini yozing.");
        }

        const targetTgId = ctx.message.reply_to_message.from.id;

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('telegram_id', targetTgId)
            .single();

        if (error || !data) {
            return ctx.reply("❌ Foydalanuvchi botda ro‘yxatdan o‘tmagan.");
        }

        worker = data;
    }

    // 🔹 2. @USERNAME ORQALI
    else {
        const parts = ctx.message.text.split(' ');

        if (parts.length < 3) {
            return ctx.reply(
                "⚠️ Format:\n/newtask @username Vazifa\n\nYoki user xabariga reply qiling",
                { parse_mode: 'Markdown' }
            );
        }

        const username = parts[1].replace('@', '');
        title = parts.slice(2).join(' ');

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('username', username)
            .single();

        if (error || !data) {
            return ctx.reply("❌ Username topilmadi yoki botda yo‘q.");
        }

        worker = data;
    }

    // 🔹 VAZIFANI SAQLASH
    const { error: taskError } = await supabase.from('tasks').insert([{
        title,
        assigned_to: worker.id,
        created_by: creator.id,
        team_id: creator.current_team_id || null,
        status: 'pending'
    }]);

    if (taskError) {
        console.error(taskError);
        return ctx.reply("⚠️ Vazifa yaratishda xatolik.");
    }

    ctx.reply("✅ Vazifa muvaffaqiyatli biriktirildi!");

    bot.telegram.sendMessage(
        worker.telegram_id,
        `📝 *Yangi vazifa:* ${title}\n👤 Kimdan: @${ctx.from.username || 'Admin'}`,
        { parse_mode: 'Markdown' }
    );
});


// Jamoaga qo'shish actions (Old kodingiz)
bot.action(/assign_team_(\d+)/, async (ctx) => {
    const { data: teams } = await supabase.from('teams').select('*');
    const targetTgId = ctx.match[1];
    const buttons = teams.map(t => [Markup.button.callback(`🔹 ${t.name}`, `add_to_team_${t.id}_${targetTgId}`)]);
    ctx.reply("Qaysi jamoaga qo'shmoqchisiz?", Markup.inlineKeyboard(buttons));
});

bot.action(/add_to_team_(.+)_(\d+)/, async (ctx) => {
    const [_, teamId, targetTgId] = ctx.match;
    const { data: user } = await supabase.from('profiles').select('id').eq('telegram_id', targetTgId).single();
    await supabase.from('team_members').upsert([{ team_id: teamId, user_id: user.id }], { onConflict: 'team_id, user_id' });
    bot.telegram.sendMessage(targetTgId, "🎊 Sizni jamoaga qo'shishdi!");
    ctx.editMessageText("✅ Muvaffaqiyatli qo'shildi.");
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        await bot.handleUpdate(req.body);
        res.status(200).json({ ok: true });
    } else {
        res.status(200).send('Bot Status: Active');
    }
};