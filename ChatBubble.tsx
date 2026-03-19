
import React from 'react';
import { COLORS } from '../constants';

interface ChatBubbleProps {
  onClick: () => void;
  isOpen: boolean;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ onClick, isOpen }) => {
  return (
    <button
      onClick={onClick}
      style={{ backgroundColor: COLORS.sfcRed }}
      className={`fixed bottom-6 right-6 w-16 h-16 rounded-full flex items-center justify-center text-white shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95 z-50`}
    >
      {isOpen ? (
        <i className="fa-solid fa-xmark text-2xl"></i>
      ) : (
        <i className="fa-solid fa-comments text-2xl"></i>
      )}
    </button>
  );
};

export default ChatBubble;
