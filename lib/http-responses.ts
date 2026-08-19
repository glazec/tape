export function redirectSeeOther(location: string) {
  return new Response(null, {
    headers: { location },
    status: 303,
  });
}
