import { Redirect } from 'expo-router';

/** Entry point for the signed-out group. */
export default function AuthIndex() {
  return <Redirect href="/(auth)/login" />;
}
