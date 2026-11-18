/**
 * error-boundary.tsx — a top-level error boundary for the native app.
 *
 * A runtime throw anywhere in the mounted tree would otherwise leave a blank
 * screen with no information. This boundary catches it and renders the error
 * message + stack on a visible surface, so failures are diagnosable on-device
 * (especially on a release APK where no Metro console is attached).
 */

import React from 'react';
import { ScrollView, Text, View } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    this.setState({ error, info: info.componentStack });
  }

  render(): React.ReactNode {
    const { error, info } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: '#0B0C10' }}
        contentContainerStyle={{ padding: 24, paddingTop: 64 }}
      >
        <Text style={{ color: '#00F5D4', fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
          App error
        </Text>
        <Text style={{ color: '#FFFFFF', fontSize: 15, marginBottom: 16 }}>
          {error.name}: {error.message}
        </Text>
        <Text style={{ color: '#9BA1A6', fontSize: 12 }}>{error.stack}</Text>
        {info ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: '#9BA1A6', fontSize: 12 }}>{info}</Text>
          </View>
        ) : null}
      </ScrollView>
    );
  }
}
