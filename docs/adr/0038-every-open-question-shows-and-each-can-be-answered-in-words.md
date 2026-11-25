# Every open question shows, and each can be answered in words

**Status:** accepted with the command bar spec (2026-11-13). Not yet built.

When a request needs more than one Clarification, GridCue shows them all at once, each with the part of the request it is about. The User answers each with a choice, or in words.

Before this, only the first Clarification showed, and only when it had choices. A run of every labelled request with the Mock Provider found 197 that end in a question, and 161 of those, 82%, have no choices: most ask for one part to be said again. A request with two questions, where the first had no choices, left the second out of reach. A real Host application, by the owner's report, showed a question only when it had choices (command bar grill, 2026-11-13).

What an answer in words is:

- **For a question with choices, typed text must name exactly one of them,** by its label or a declared alias, as a whole name. One fit answers the question, with no Intent Provider called. None, or more than one, leaves the question open. The text is never read as a request.
- **For a question with no choices, the User gives a new wording of that part.** It replaces the part in the User's own text, and the whole request is proposed again: read, checked and shown as a Preview like any request. The User's other words stay exactly as typed.
- **An answer to another question is kept only when it is certain to mean the same thing.** Otherwise that question is asked again.
- **A question about the whole request has no part.** It shows with its choices, or with none.

This supersedes "ask one focused question" in the product definition. That line is rewritten when this is built, to say: show every open question with its part. A Clarification is no longer a single question: a View Plan can carry several.

Choices alone were rejected, because most questions have none. One question at a time was rejected, because a first question the User can't answer hides the rest.

The cost is a larger bar when a request goes wrong in several places, and one more Intent Provider call for each new wording, which can read differently from the first. It is a new request, so every check runs on it again.

This would change if a held-out set of typed answers gives one wrong view, or if Users in a representative Host answer most questions by choice anyway.
