require('dotenv').config();
const Botkit = require('botkit');
const GithubAPI = require('github');

if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET || !process.env.SLACK_VERIFICATION_TOKEN) {
    console.log('Error: Specify CLIENT_ID, CLIENT_SECRET, VERIFICATION_TOKEN and PORT in environment');
    process.exit(1);
}

const controller = Botkit.slackbot({
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    scopes: ['commands'],
    json_file_store: __dirname + '/.data/db/'
});

// Begin workaround for https://github.com/howdyai/botkit/issues/590
let bot = controller.spawn({
    token: process.env.SLACK_BOT_TOKEN
}).startRTM()

bot.api.auth.test({}, (err, res) => {
    controller.storage.teams.save({
        id: res.team_id,
        bot: {
            user_id: res.user_id,
            name: res.user
        }
    }, (err) => {
        if (err) {
            console.error(err)
        }
    })
})
// End workaround

controller.setupWebserver(process.env.PORT || 9876, function (err, webserver) {
    controller.createWebhookEndpoints(controller.webserver);

    controller.createOauthEndpoints(controller.webserver, function (err, req, res) {
        if (err) {
            res.status(500).send('ERROR: ' + err);
        }
        else {
            res.send('Success!');
        }
    });
});

const github = GithubAPI({
    headers: {
        'Accept': 'application/vnd.github.v3.text-match+json'
    }
});
github.authenticate({
    type: 'oauth',
    token: process.env.GITHUB_ACCESS_TOKEN
});

controller.on('slash_command', function (slashCommand, message) {

    switch (message.command) {
        case `/${process.env.SLASH_COMMAND || "github"}`:
            if (message.token !== process.env.SLACK_VERIFICATION_TOKEN) return; //just ignore it.

            // if no text was supplied, treat it as a help command
            if (message.text === "" || message.text === "help") {
                slashCommand.replyPrivate(message,
                    "I echo back what you tell me. " +
                    "Try typing `/echo hello` to see.");
                return;
            }

            slashCommand.replyPrivateDelayed(message, `🔎 Searching for "${message.text}"...`, function() {
                github.search.code({ q: encodeURIComponent(message.text) + "+repo:RobotsAndPencils/RobotFood+in:file,path", per_page: 5 }, function (error, response) {
                    const responseModel = (response.data.items || []).map(function(item) {
                        return {
                            name: item.name,
                            url: item.html_url,
                            matches: item.text_matches.filter(match => match.property === "content").map(match => match.fragment)
                        };
                    });
                    const text = responseModel.map(function(result) {
                        return `*<${result.url}|${result.name}>*\n` + result.matches.map(match => `> ${match.replace(/[\r\n`]/gm, " ")}`).join("\n\n");
                    }).join("\n");
                    slashCommand.replyPrivate(message, text);
                });
            });

            break;
        default:
            slashCommand.replyPublic(message, "I'm afraid I don't know how to " + message.command + " yet.");
    }
});
