export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center">
      <div className="w-[500px] rounded-2xl bg-white p-10 shadow-xl">

        <h1 className="text-4xl font-bold">
          Candid OS
        </h1>

        <p className="mt-2 text-gray-500">
          Customer Portal
        </p>

        <div className="mt-10 space-y-4">

          <a
            href="/login"
            className="block w-full rounded-lg bg-blue-600 py-3 text-center text-white"
          >
            Login
          </a>

          <a
            href="/register"
            className="block w-full rounded-lg border py-3 text-center"
          >
            Register
          </a>

        </div>

      </div>
    </main>
  );
}