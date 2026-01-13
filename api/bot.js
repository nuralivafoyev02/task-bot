const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_ID = parseInt(process.env.OWNER_ID);
const WEBAPP_URL = process.env.WEBAPP_URL;

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* =======================
   ROLE MIDDLEWARE
======================= */
const requireRole = (roles = []) => async (ctx, next) => {
    const { data: user } = await supabase
        .from('profiles')
        .select('role')
        .eq('telegram_id', ctx.from.id)
        .single();

    if (!user || !roles.includes(user.role)) {
        return ctx.reply("❌ Sizda ruxsat yo‘q.");
    }
    return next();
};

/* =======================
   KEYBOARD
======================= */
const getMenuByRole = (role) => {
    const buttons = [
        [Markup.button.webApp('📱 Mini Ilovani ochish', WEBAPP_URL)]
    ];

    if (role === 'admin' || role === 'owner') {
        buttons.push([
            Markup.button.text('➕ Yangi vazifa'),
            Markup.button.text('👥 Jamoalarim')
        ]);
    }

    if (role === 'owner') {
        buttons.push([
            Markup.button.text('📊 Foydalanuvchilar'),
            Markup.button.text('⚙️ Tizim holati')
        ]);
    }

    return Markup.keyboard(buttons).resize();
};

/* =======================
   HELP TEXT
======================= */
const getHelpText = (role, name) => {
    if (role === 'user') {
        return `👋 Salom, ${name}!

👤 Siz oddiy foydalanuvchisiz.

📌 Sizga biriktirilgan vazifalarni Mini Ilovada ko‘rishingiz mumkin.

/start — menyu
/mytasks — vazifalarim`;
    }

    if (role === 'admin') {
        return `👋 Salom, ${name}!

⚡ Siz ADMINsiz.

📌 Buyruqlar:
/newtask — vazifa berish
/createtask — reply orqali vazifa
/newteam — jamoa yaratish

💡 Tugmalardan foydalaning`;
    }

    if (role === 'owner') {
        return `👑 Salom, ${name}!

Siz OWNERsiz — to‘liq nazorat sizda.

📌 Buyruqlar:
/users — foydalanuvchilar
/newadmin — admin tayinlash
/newtask — vazifa
/newteam — jamoa`;
    }
};

/* =======================
   START
======================= */
bot.start(async (ctx) => {
    const { id, username, first_name } = ctx.from;

    const { data: profile } = await supabase
        .from('profiles')
        .upsert({
            telegram_id: id,
            username: username || 'user',
            full_name: first_name,
            role: id === OWNER_ID ? 'owner' : 'user'
        }, { onConflict: 'telegram_id' })
        .select()
        .single();

    ctx.reply(getHelpText(profile.role, first_name), {
        parse_mode: 'Markdown',
        ...getMenuByRole(profile.role)
    });
});

/* =======================
   KEYBOARD HANDLERS
======================= */

// ➕ Yangi vazifa
bot.hears('➕ Yangi vazifa', requireRole(['admin', 'owner']), (ctx) => {
    ctx.reply(
        "📝 Vazifa yaratish:\n/newtask @username Vazifa\n\nYoki user xabariga reply qilib:\n/createtask Vazifa",
        { parse_mode: 'Markdown' }
    );
});

// 👥 Jamoalarim
bot.hears('👥 Jamoalarim', requireRole(['admin', 'owner']), async (ctx) => {
    const { data: user } = await supabase
        .from('profiles')
        .select('id')
        .eq('telegram_id', ctx.from.id)
        .single();

    const { data: teams } = await supabase
        .from('teams')
        .select('name')
        .eq('created_by', user.id);

    if (!teams || teams.length === 0) {
        return ctx.reply("📭 Sizda hali jamoalar yo‘q.\n/newteam orqali yarating.");
    }

    let text = "👥 *Sizning jamoalaringiz:*\n\n";
    teams.forEach(t => text += `• ${t.name}\n`);

    ctx.reply(text, { parse_mode: 'Markdown' });
});

// 📊 Foydalanuvchilar
bot.hears('📊 Foydalanuvchilar', requireRole(['owner']), async (ctx) => {
    const { data: users } = await supabase
        .from('profiles')
        .select('full_name, username, role');

    let text = "👥 *Foydalanuvchilar:*\n\n";
    users.forEach(u => {
        const icon = u.role === 'owner' ? '👑' : u.role === 'admin' ? '⚡' : '👤';
        text += `${icon} ${u.full_name} — @${u.username}\n`;
    });

    ctx.reply(text, { parse_mode: 'Markdown' });
});

// ⚙️ Tizim holati
bot.hears('⚙️ Tizim holati', requireRole(['owner']), async (ctx) => {
    const [{ count: users }, { count: tasks }] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('tasks').select('*', { count: 'exact', head: true })
    ]);

    ctx.reply(`⚙️ *Tizim holati:*

👥 Foydalanuvchilar: ${users}
📝 Vazifalar: ${tasks}`, { parse_mode: 'Markdown' });
});

/* =======================
   WEBHOOK EXPORT
======================= */
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        await bot.handleUpdate(req.body);
        res.status(200).json({ ok: true });
    } else {
        res.status(200).send('Bot Active');
    }
};
