import React from "react";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    console.error("Application render error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="badminton-app badminton-auth-page"><section className="badminton-auth-card"><h1>หน้าเว็บทำงานผิดพลาด</h1><p>ข้อมูลที่บันทึกไว้ไม่หาย กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง</p><button className="badminton-primary" onClick={() => window.location.reload()} type="button">โหลดหน้าใหม่</button></section></main>;
  }
}
