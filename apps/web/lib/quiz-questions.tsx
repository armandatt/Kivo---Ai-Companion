export const questions = [
  {
    id: 'primaryDomain',
    question: 'What do you want help with right now?',
    options: [
      { label: 'Gym 💪', value: 'gym' },
      { label: 'Study 📚', value: 'study' },
      { label: 'Work 🚀', value: 'work' },
      { label: 'Life 🧘', value: 'life' },
    ],
  },
  {
    id: 'secondaryDomains',
    question: 'Anything else you want to improve?',
    options: [
      { label: 'Gym', value: 'gym' },
      { label: 'Study', value: 'study' },
      { label: 'Work', value: 'work' },
      { label: 'Life', value: 'life' },
      { label: 'Nothing else', value: 'none' },
    ],
  },
  {
    id: 'seriousness',
    question: 'How serious are you?',
    options: [
      { label: 'Just exploring', value: 'low' },
      { label: 'Kinda serious', value: 'medium' },
      { label: 'I need to fix this', value: 'high' },
      { label: "I'm all in", value: 'extreme' },
    ],
  },
  {
    id: 'consistency',
    question: 'What happens after 2–3 weeks?',
    options: [
      { label: 'I quit', value: 'quit' },
      { label: 'I slow down', value: 'slow' },
      { label: 'I stay consistent', value: 'consistent' },
    ],
  },
  {
    id: 'motivation',
    question: 'What pushes you most?',
    options: [
      { label: 'Strict', value: 'strict' },
      { label: 'Hype', value: 'hype' },
      { label: 'Calm', value: 'chill' },
      { label: 'Call me out', value: 'challenger' },
    ],
  },
  {
    id: 'failurePattern',
    question: 'When you fall off?',
    options: [
      { label: 'Lose momentum', value: 'lose' },
      { label: 'Feel guilty', value: 'guilt' },
      { label: 'Restart next day', value: 'restart' },
      { label: 'Ignore', value: 'ignore' },
    ],
  },
  {
    id: 'emotionalTrigger',
    question: 'What hits hardest?',
    options: [
      { label: 'Missing goals', value: 'goal' },
      { label: 'Being called out', value: 'ego' },
      { label: 'No results', value: 'results' },
      { label: 'Feeling stuck', value: 'stuck' },
    ],
  },
]
