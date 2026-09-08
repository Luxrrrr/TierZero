/**
 * Shown when the dashboard cannot reach the bot's control API. The bot owns
 * every setting, so there is nothing useful to render without it, and the
 * operator needs to know which of the two processes to go and look at.
 */
export function BotOffline() {
  return (
    <main>
      <h1>The bot is not responding</h1>
      <p>
        The dashboard reaches the bot over its control API, and that connection
        was refused. Either the bot is not running, or it is listening
        somewhere other than the address the dashboard is configured with.
      </p>
      <p>Start the bot, then reload this page.</p>
    </main>
  );
}
