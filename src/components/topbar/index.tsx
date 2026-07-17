export function Topbar() {
  return (
    <header className='topbar'>
      <div className='topbar-title'>
        对话：<span className='name'>白酒板块 + 持仓分析</span>
      </div>
      <div className='topbar-right'>
        <span className='status'>
          <span className='status-dot' />
          数据源已连接
        </span>
        <div className='ticker'>
          <span>
            沪 3115.89 <span className='up'>+0.23%</span>
          </span>
          <span>
            深 9822.16 <span className='up'>+0.41%</span>
          </span>
        </div>
      </div>
    </header>
  );
}
