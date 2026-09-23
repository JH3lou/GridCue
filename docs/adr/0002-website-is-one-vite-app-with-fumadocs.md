# The website is one Vite app using Fumadocs on React Router

The marketing page, developer docs, and hosted component registry live in one Vite + React + Tailwind + shadcn/ui app. Fumadocs runs on React Router, and shadcn typeset styles the docs prose. We chose this over Next.js with Fumadocs, which is the better-documented path, because the owner requires Vite for the website and one app gives one theme and one deploy.

The Vite requirement applies only to the website. The published packages must stay bundler- and framework-neutral.
