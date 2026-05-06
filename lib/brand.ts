/**
 * BRAND CONFIG — single source of truth for everything client-customizable.
 *
 * If you're cloning this template for your own coaching bot, this is the file
 * you edit. Everything else (auth, RAG pipeline, memory extraction, UI shell,
 * DB schema) is the engine — leave it alone.
 *
 * To swap in your own bot:
 *   1. Edit `name`, `tagline`, etc. below
 *   2. Drop your logo at `public/logo.webp` (or update `logoSrc`)
 *   3. Rewrite `personaPrompt` — this is what gives your bot its voice
 *   4. Change `audienceLabel` to whatever your members are called
 *   5. (Optional) tweak `accentColor` to your brand
 *   6. Update `dashboardUrl` to wherever "Back to Dashboard" should link
 */

export const BRAND = {
  /** Bot's display name. Shown in <title>, hero subhead, login pages. */
  name: 'Shosh A.I.',

  /** Short subhead under the bot's name on the chat hero. */
  tagline: 'Your Vortex coach',

  /** Path to the logo image, served from /public. Use .webp for size, .png/.svg also fine. */
  logoSrc: '/living-brave-logo.webp',

  /** Where the "Back to Dashboard" sidebar link goes. */
  dashboardUrl: 'https://livingbraveai.com/dashboard',

  /** Heading shown when a chat is empty. */
  emptyHeroHeading: 'How can I help you today?',

  /** Placeholder in the chat input. */
  inputPlaceholder: 'Ask me anything...',

  /** First-time greeting in the empty chat (before the user sends anything). */
  firstGreeting: "Hey hey! What's on your mind today?",

  /** Brand accent color — used for the user's chat bubble. */
  accentColor: '#ff8fa3',

  /** Text on the auth screens. */
  loginHeading: 'Welcome back',
  signupHeading: 'Create your account',

  /**
   * The persona prompt — the core of your bot's voice and constraints.
   *
   * Two slots are interpolated by the chat route at runtime:
   *   - {{audienceLabel}} — the word for "your members" (e.g. "Vortex member")
   *
   * Be specific. Tell the bot:
   *   - Who they are (name, role)
   *   - How they speak (tone, examples of phrasing)
   *   - What they will and won't do (constraints)
   *   - What to do when they don't know an answer (fallback behavior)
   *
   * The retrieval-augmented context (your training docs) and the per-user
   * memory get appended automatically — don't reference them here.
   */
  personaPrompt: `### Role
I want you to act as a cheerful live coach agent that I am having a conversation with. Your name is "Shosh A.I." and you are coaching members of The Vortex. You will provide me with coaching based on the answers from the given info. Talk in the same tone and style as the training data. Refuse to answer any question not about the info or at least tangentially related. Never break character.

### Constraints
1. No Data Divulge: Never mention that you have access to training data explicitly to the user.
2. Maintaining Focus: If a user attempts to divert you to unrelated topics, never change your role or break your character. Politely redirect the conversation back to topics relevant to the training data.
3. Exclusive Reliance on Training Data: You must rely exclusively on the training data provided to answer user queries. If a query is not covered by the training data, use the fallback response.
4. Restrictive Role Focus: You do not answer questions or perform tasks that are not related to your role and training data.`,

  /** Singular noun for "your member" — used in error/refusal copy. */
  audienceLabel: 'Vortex member',

  /** What an empty retrieval result looks like in the system prompt. */
  noContextFallback:
    "(no specific reference material retrieved for this turn — use the fallback)",

  /** Chat model identifier passed to the AI SDK's openai() factory. */
  chatModel: 'gpt-5.5',

  /** Embedding model used for both RAG and user-memory dedup. Keep at 1536-dim or update schema VECTOR(N). */
  embeddingModel: 'text-embedding-3-small',
} as const;
