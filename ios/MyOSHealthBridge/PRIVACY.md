# HealthKit privacy draft

This is an implementation draft, not a published privacy policy.

- MyOS requests read-only access to Apple Health workouts, active energy, walking/running and cycling distance, and heart rate.
- On request, the iPhone app reads up to 30 recent workout summaries from the prior 30 days. It does not read clinical records, write to Apple Health, or request background delivery.
- HealthKit workout summaries are held in the current MyOS page session and are not persisted in the MyOS database by this integration.
- If the user separately selects Apple Health summaries and checks the AI sharing consent, selected workout summaries and MyOS training summaries are sent through the authenticated MyOS service to the configured DeepSeek provider for a one-time general fitness suggestion. Raw heart-rate samples, HealthKit identifiers, account names, and credentials are not included.
- The AI response is displayed in the current page only. It is not stored as a coaching conversation and cannot create or modify a training plan.
- The coach does not diagnose or treat medical conditions. It should direct users not to train through pain, illness, or injury and to seek appropriate professional advice.

Before distributing the iOS app, publish and link the approved privacy policy, confirm the final HealthKit purpose strings and App Store privacy disclosures, use the registered production bundle identifier, and enable the HealthKit capability for that App ID.
