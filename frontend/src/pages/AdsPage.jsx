// enterprate.ai/ads: the current advert image on its own page, for sharing in campaigns. The file itself is /media/brainbox.png.
export default function AdsPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-4">
      <a href="/" aria-label="Go to EnterprateAI">
        <img src="/media/brainbox.png" alt="EnterprateAI: tell it the job, it does the work and asks only for what it needs" className="h-auto w-full max-w-[1672px] rounded-2xl" />
      </a>
    </main>
  );
}
