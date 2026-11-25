import React from 'react';

export const AppFooter: React.FC = () => {
  return (
    <footer
      style={{
        width: '100%',
        padding: '2.5rem 1rem 3rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        fontSize: '0.84rem',
        letterSpacing: '0.035em',
        color: '#858296',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        marginTop: '3.5rem',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '0.35rem',
          lineHeight: 1.6,
        }}
      >
        <span>Made with love by Galih</span>
        <a
          href="https://johansa.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#f4f4f5',
            fontWeight: 700,
            textDecoration: 'underline',
            textUnderlineOffset: '4px',
            textDecorationThickness: '1.5px',
            textDecorationColor: '#ff00ff',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#ff00ff';
            e.currentTarget.style.textShadow = '0 0 10px rgba(255, 0, 255, 0.6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#f4f4f5';
            e.currentTarget.style.textShadow = 'none';
          }}
        >
          Johansa
        </a>
        <span>Juansaputra</span>  
      </div>
    </footer>
  );
};

export default AppFooter;
