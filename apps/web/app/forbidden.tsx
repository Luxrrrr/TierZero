export default function Forbidden() {
  return (
    <main>
      <h1>You can&apos;t configure this server</h1>
      <p>
        You need the Manage Server permission on that Discord server, and the
        bot needs to already be a member of it. If you just added the bot,
        reload the guild list.
      </p>
    </main>
  );
}
